import { loadSkills } from "../runtime/skills.js";
import { runContentAgent } from "../runtime/agent.js";
import {
  generatePollinationsImage,
  MAX_IMAGE_BYTES,
} from "../runtime/providers.js";
import {
  isRedditUrl,
  normalizeDestination,
  prepareRedditDraft,
  submitUrl,
} from "../runtime/reddit.js";

const $ = (id) => document.getElementById(id);
let media = [];
let history = [];
let workflow = null;
let version = 0;
let controller = null;
let preparing = false;
let currentTab = null;
let saveTimer;
let saveQueue = Promise.resolve();
let libraryPromise;

function message(id, text, type = "success") {
  $(id).textContent = text;
  $(id).className = `result-message ${text ? type : "hidden"}`;
}

function setBusy(busy) {
  for (const id of [
    "btnGenerate",
    "btnAiImage",
    "btnUploadMedia",
    "btnPublish",
  ])
    $(id).disabled = busy;
  $("btnCancel").classList.toggle("hidden", !busy);
}

function draftData() {
  return {
    prompt: $("promptInput").value,
    destination: $("destinationInput").value,
    title: $("postTitle").value,
    body: $("postBody").value,
    imagePrompt: $("aiImagePromptInput").value,
    attachedMedia: media.map(({ previewUrl, ...item }) => item),
    history,
    workflow,
    updatedAt: Date.now(),
  };
}

function saveDraft() {
  clearTimeout(saveTimer);
  const draft = draftData();
  // Serialize writes so an older edit cannot win after a newer one.
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => chrome.storage.local.set({ dinoDraft: draft }));
  saveQueue.catch(() =>
    message(
      "resultMessage",
      "Không lưu được bản nháp (có thể hết dung lượng). Giữ bảng bên mở và tải ảnh nhỏ hơn.",
      "error",
    ),
  );
  return saveQueue;
}

function changed() {
  version++;
  workflow = null;
  controller?.abort(new DOMException("Bản nháp đã thay đổi.", "AbortError"));
  $("btnPublish").querySelector(".btn-text").textContent =
    "Điền bản nháp vào Reddit";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 300);
}

function renderChat() {
  $("chatHistory").replaceChildren();
  for (const entry of history) {
    const line = document.createElement("p");
    line.className = `chat-message ${entry.role}`;
    line.textContent = `${entry.role === "user" ? "Bạn" : "Dino"}: ${entry.content}`;
    $("chatHistory").append(line);
  }
  $("chatHistory").scrollTop = $("chatHistory").scrollHeight;
}

function renderMedia() {
  $("mediaCount").textContent = `${media.length} ảnh`;
  $("mediaEmptyNotice").classList.toggle("hidden", Boolean(media.length));
  $("mediaPreviewList").classList.toggle("hidden", !media.length);
  $("mediaPreviewList").replaceChildren();
  for (const item of media) {
    const card = document.createElement("div");
    card.className = "media-card";
    const image = document.createElement("img");
    image.src = item.base64;
    image.alt = item.prompt || item.name;
    const remove = document.createElement("button");
    remove.className = "media-btn-remove";
    remove.textContent = "✕";
    remove.title = "Xóa ảnh khỏi bản nháp";
    remove.onclick = (event) => {
      event.stopPropagation();
      media = [];
      changed();
      renderMedia();
    };
    card.append(image, remove);
    if (item.isAi) {
      const badge = document.createElement("span");
      badge.className = "media-ai-badge";
      badge.textContent = "AI";
      card.append(badge);
    }
    $("mediaPreviewList").append(card);
  }
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Không đọc được tệp ảnh."));
    reader.readAsDataURL(blob);
  });
}

async function makeAttachment(
  blob,
  { name, isAi = false, prompt = "", provider = "local" } = {},
) {
  if (
    !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
      blob.type,
    ) ||
    !blob.size ||
    blob.size > MAX_IMAGE_BYTES
  ) {
    throw new Error("Chỉ hỗ trợ PNG, JPEG, GIF, WebP từ 1 byte đến 4 MiB.");
  }
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) throw new Error("Tệp không phải ảnh đọc được.");
  bitmap.close();
  const bytes = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  }[blob.type];
  return {
    id: crypto.randomUUID(),
    name: name || `dino-art-${Date.now()}.${extension}`,
    type: blob.type,
    size: blob.size,
    sha256,
    base64: await toDataUrl(blob),
    isAi,
    prompt,
    provider,
  };
}

async function importFile(files) {
  if (controller || preparing || !files?.length) return;
  const initialVersion = version;
  try {
    if (files.length !== 1)
      throw new Error("Chọn một ảnh cho phiên thử nghiệm này.");
    const item = await makeAttachment(files[0], { name: files[0].name });
    if (initialVersion !== version) return;
    media = [item];
    changed();
    renderMedia();
    await saveDraft();
    message("mediaStatusMessage", "Ảnh đã được gắn vào bản nháp cục bộ.");
  } catch (error) {
    message("mediaStatusMessage", error.message, "error");
  }
}

async function runTask(task, statusId) {
  if (controller || preparing) return;
  const own = new AbortController();
  controller = own;
  const initialVersion = version;
  setBusy(true);
  const start = Date.now();
  let stage = "Đang xử lý";
  const report = (text) => {
    stage = text;
    $("pipelineStatus").textContent =
      `${stage} (${Math.floor((Date.now() - start) / 1000)}s)`;
  };
  const interval = setInterval(() => report(stage), 1000);
  const timeout = setTimeout(
    () =>
      own.abort(
        new DOMException("Quá thời gian xử lý (180s).", "TimeoutError"),
      ),
    180000,
  );
  const ensureCurrent = () => {
    own.signal.throwIfAborted();
    if (initialVersion !== version || controller !== own)
      throw new DOMException("Bản nháp đã thay đổi.", "AbortError");
  };
  const attachImage = async (image) => {
    const item = await makeAttachment(image.blob, {
      isAi: true,
      prompt: image.prompt,
      provider: image.provider,
    });
    ensureCurrent();
    media = [item];
    workflow = null;
    renderMedia();
    await saveDraft();
    return item;
  };
  try {
    await saveDraft();
    const result = await task({
      signal: own.signal,
      ensureCurrent,
      report,
      attachImage,
    });
    ensureCurrent();
    message(statusId, result || "Hoàn tất. Hãy xem bản nháp.");
  } catch (error) {
    const aborted = own.signal.aborted;
    message(
      statusId,
      aborted
        ? own.signal.reason?.message || "Đã dừng. Bản nháp được giữ lại."
        : error.message,
      "error",
    );
  } finally {
    clearTimeout(timeout);
    clearInterval(interval);
    if (controller === own) {
      controller = null;
      setBusy(false);
    }
    $("pipelineStatus").textContent = "";
  }
}

async function chat() {
  const prompt = $("promptInput").value.trim();
  if (!prompt)
    return message("aiStatusMessage", "Nhập yêu cầu cho Dino trước.", "error");
  const input = {
    title: $("postTitle").value,
    body: $("postBody").value,
    destination: $("destinationInput").value,
    hasMedia: media.length > 0,
  };
  const previousHistory = [...history];
  await runTask(async ({ signal, ensureCurrent, report, attachImage }) => {
    const settings = await chrome.storage.local.get([
      "nvidiaApiKey",
      "brandProfile",
      "voiceGuide",
    ]);
    const library = await (libraryPromise ||= loadSkills().catch((error) => {
      libraryPromise = null;
      throw error;
    }));
    ensureCurrent();
    const output = await runContentAgent({
      prompt,
      draft: input,
      history: previousHistory,
      allowImage: true,
      library,
      apiKey: settings.nvidiaApiKey,
      brand: settings.brandProfile || "",
      voice: settings.voiceGuide || "",
      signal,
      attachImage,
      onEvent: (event) => report(event.message),
    });
    ensureCurrent();
    if (output.draft) {
      $("postTitle").value = output.draft.title;
      $("postBody").value = output.draft.body;
    }
    workflow = null;
    history = [
      ...previousHistory,
      { role: "user", content: prompt },
      { role: "assistant", content: output.message },
    ].slice(-20);
    renderChat();
    $("promptInput").value = "";
    await saveDraft();
    return output.message;
  }, "aiStatusMessage");
}

async function imageOnly() {
  const prompt =
    $("aiImagePromptInput").value.trim() || $("postTitle").value.trim();
  if (!prompt)
    return message(
      "mediaStatusMessage",
      "Nhập mô tả ảnh hoặc tiêu đề trước.",
      "error",
    );
  await runTask(async ({ signal, report, attachImage }) => {
    report("Công cụ tạo ảnh đang chạy");
    const image = await generatePollinationsImage({ prompt, signal });
    await attachImage(image);
    return "Đã tạo và gắn ảnh AI. Hãy kiểm tra trước khi đưa vào Reddit.";
  }, "mediaStatusMessage");
}

async function refreshTab() {
  try {
    [currentTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const reddit = isRedditUrl(currentTab?.url);
    $("statusDot").className = `dot ${reddit ? "green" : "red"}`;
    $("statusText").textContent = reddit
      ? "Đang dùng tab Reddit trong Chrome của bạn."
      : "Mở Reddit trong Chrome để chuẩn bị bản nháp.";
    $("btnGoSubmit").textContent = "Mở trang Submit";
    $("btnGoSubmit").classList.remove("hidden");
  } catch {
    message("resultMessage", "Không đọc được tab Chrome đang mở.", "error");
  }
}

async function openComposer() {
  const destination = normalizeDestination($("destinationInput").value);
  const url = submitUrl(destination, Boolean(media.length));
  await refreshTab();
  if (isRedditUrl(currentTab?.url))
    await chrome.tabs.update(currentTab.id, { url });
  else await chrome.tabs.create({ url });
}

async function prepare() {
  if (controller || preparing) return;
  preparing = true;
  setBusy(true);
  try {
    const destination = normalizeDestination($("destinationInput").value);
    const title = $("postTitle").value.trim();
    const body = $("postBody").value;
    if (
      !title ||
      [...title].length > 300 ||
      /[\r\n]/.test(title) ||
      body.length > 40000
    )
      throw new Error(
        "Kiểm tra tiêu đề (1–300 ký tự) và nội dung (tối đa 40000 ký tự).",
      );
    await refreshTab();
    if (!isRedditUrl(currentTab?.url))
      throw new Error("Hãy mở tab Reddit trước khi điền bản nháp.");
    const expectedUrl = new URL(submitUrl(destination, Boolean(media.length)));
    const actualUrl = new URL(currentTab.url);
    if (
      actualUrl.pathname.replace(/\/+$/, "").toLowerCase() !==
      expectedUrl.pathname.replace(/\/+$/, "").toLowerCase()
    ) {
      await openComposer();
      workflow = { state: "waiting_composer", destination };
      await saveDraft();
      message(
        "resultMessage",
        "Đã mở trang soạn bài. Hoàn thành đăng nhập / CAPTCHA nếu có, chọn đúng nơi đăng, rồi bấm Tiếp tục.",
      );
      $("btnPublish").querySelector(".btn-text").textContent =
        "Tiếp tục điền bản nháp";
      return;
    }
    const initialVersion = version;
    const tabId = currentTab.id;
    const payload = {
      title,
      body,
      destination,
      media: media.map(({ name, type, base64, sha256 }) => ({
        name,
        type,
        base64,
        sha256,
      })),
    };
    setBusy(true);
    workflow = { state: "preparing", destination };
    await saveDraft();
    // No MAIN-world retry: an ambiguous response may already have attached media.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: prepareRedditDraft,
      args: [payload],
    });
    if (initialVersion !== version)
      throw new Error(
        "Bản nháp đã thay đổi trong khi điền. Kiểm tra Reddit trực tiếp.",
      );
    const output = results?.[0]?.result;
    if (!output?.state)
      throw new Error(
        "Không biết form đã điền đến đâu. Kiểm tra Reddit trước khi thử lại.",
      );
    workflow = { ...output, destination };
    await saveDraft();
    message(
      "resultMessage",
      output.message,
      ["prepared", "waiting_login", "waiting_verification"].includes(
        output.state,
      )
        ? "success"
        : "error",
    );
    $("btnPublish").querySelector(".btn-text").textContent =
      output.state.startsWith("waiting")
        ? "Tiếp tục sau xác minh"
        : "Điền bản nháp vào Reddit";
  } catch (error) {
    workflow = { state: "blocked", message: error.message };
    await saveDraft().catch(() => {});
    message("resultMessage", error.message, "error");
  } finally {
    preparing = false;
    setBusy(false);
  }
}

async function restore() {
  const settings = await chrome.storage.local.get([
    "nvidiaApiKey",
    "brandProfile",
    "voiceGuide",
    "savedDestination",
    "dinoDraft",
  ]);
  $("apiKeyInput").value = settings.nvidiaApiKey || "";
  $("brandInput").value = settings.brandProfile || "";
  $("voiceInput").value = settings.voiceGuide || "";
  const draft = settings.dinoDraft;
  $("destinationInput").value =
    draft?.destination || settings.savedDestination || "r/test";
  if (draft) {
    $("promptInput").value = draft.prompt || "";
    $("postTitle").value = draft.title || "";
    $("postBody").value = draft.body || "";
    $("aiImagePromptInput").value = draft.imagePrompt || "";
    media = (Array.isArray(draft.attachedMedia) ? draft.attachedMedia : [])
      .filter(
        (item) =>
          /^image\/(jpeg|png|gif|webp)$/.test(item.type) &&
          typeof item.base64 === "string" &&
          item.base64.length <= 5700000,
      )
      .slice(0, 1);
    history = (Array.isArray(draft.history) ? draft.history : [])
      .filter(
        (entry) =>
          ["user", "assistant"].includes(entry.role) &&
          typeof entry.content === "string",
      )
      .slice(-20);
    workflow = draft.workflow || null;
    if (workflow?.message)
      message(
        "resultMessage",
        workflow.message,
        workflow.state === "blocked" ? "error" : "success",
      );
    if (workflow?.state === "preparing")
      message(
        "resultMessage",
        "Lượt điền trước đã bị gián đoạn. Kiểm tra form Reddit trước khi thử lại.",
        "error",
      );
  }
  renderChat();
  renderMedia();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await restore();
    await refreshTab();
    for (const id of [
      "promptInput",
      "destinationInput",
      "postTitle",
      "postBody",
      "aiImagePromptInput",
    ])
      $(id).addEventListener("input", changed);
    $("btnGenerate").onclick = chat;
    $("btnAiImage").onclick = imageOnly;
    $("btnCancel").onclick = () =>
      controller?.abort(
        new DOMException("Đã dừng theo yêu cầu.", "AbortError"),
      );
    $("btnPublish").onclick = prepare;
    $("btnGoSubmit").onclick = () =>
      openComposer().catch((error) =>
        message("resultMessage", error.message, "error"),
      );
    $("btnUploadMedia").onclick = () => $("mediaFileInput").click();
    $("mediaFileInput").onchange = async (event) => {
      await importFile(event.target.files);
      event.target.value = "";
    };
    $("mediaDropzone").ondragover = (event) => {
      event.preventDefault();
      $("mediaDropzone").classList.add("dragover");
    };
    $("mediaDropzone").ondragleave = () =>
      $("mediaDropzone").classList.remove("dragover");
    $("mediaDropzone").ondrop = (event) => {
      event.preventDefault();
      $("mediaDropzone").classList.remove("dragover");
      importFile(event.dataTransfer.files);
    };
    $("btnClearDraft").onclick = async () => {
      controller?.abort(
        new DOMException("Bản nháp đã được làm mới.", "AbortError"),
      );
      media = [];
      history = [];
      workflow = null;
      for (const id of [
        "promptInput",
        "postTitle",
        "postBody",
        "aiImagePromptInput",
      ])
        $(id).value = "";
      changed();
      renderChat();
      renderMedia();
      await saveDraft();
      message("aiStatusMessage", "");
      message("mediaStatusMessage", "");
      message("resultMessage", "Đã làm mới bản nháp cục bộ.");
    };
    $("btnSettings").onclick = () =>
      $("settingsModal").classList.remove("hidden");
    $("btnCloseSettings").onclick = () =>
      $("settingsModal").classList.add("hidden");
    $("btnSaveSettings").onclick = async () => {
      try {
        await chrome.storage.local.set({
          nvidiaApiKey: $("apiKeyInput").value.trim(),
          brandProfile: $("brandInput").value,
          voiceGuide: $("voiceInput").value,
        });
        $("settingsModal").classList.add("hidden");
        message("resultMessage", "Đã lưu cấu hình.");
      } catch {
        message("resultMessage", "Không lưu được cấu hình.", "error");
      }
    };
    chrome.tabs.onActivated.addListener(refreshTab);
    chrome.tabs.onUpdated.addListener((id, change) => {
      if (id === currentTab?.id && change.status === "complete") refreshTab();
    });
    window.addEventListener("pagehide", () => {
      controller?.abort();
      saveDraft();
    });
  } catch (error) {
    message(
      "resultMessage",
      `Không khởi tạo được DinoPost: ${error.message}`,
      "error",
    );
  }
});
