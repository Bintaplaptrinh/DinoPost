// popup/popup.js - Điều khiển giao diện Extension, gọi MiniMax AI và tạo ảnh AI

const DEFAULT_API_KEY = "";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL_NAME = "minimaxai/minimax-m3.1-flash";

// DOM Elements
const tabStatusEl = document.getElementById("tabStatus");
const statusDotEl = document.getElementById("statusDot");
const statusTextEl = document.getElementById("statusText");
const btnGoSubmit = document.getElementById("btnGoSubmit");

const promptInput = document.getElementById("promptInput");
const btnGenerate = document.getElementById("btnGenerate");
const aiStatusMessage = document.getElementById("aiStatusMessage");

const destinationInput = document.getElementById("destinationInput");
const postTitle = document.getElementById("postTitle");
const postBody = document.getElementById("postBody");
const chkAutoSubmit = document.getElementById("chkAutoSubmit");
const btnPublish = document.getElementById("btnPublish");
const resultMessage = document.getElementById("resultMessage");

// Media Elements
const mediaFileInput = document.getElementById("mediaFileInput");
const btnUploadMedia = document.getElementById("btnUploadMedia");
const btnAiImage = document.getElementById("btnAiImage");
const aiPromptRow = document.getElementById("aiPromptRow");
const aiImagePromptInput = document.getElementById("aiImagePromptInput");
const mediaDropzone = document.getElementById("mediaDropzone");
const mediaEmptyNotice = document.getElementById("mediaEmptyNotice");
const mediaPreviewList = document.getElementById("mediaPreviewList");
const mediaCount = document.getElementById("mediaCount");
const mediaStatusMessage = document.getElementById("mediaStatusMessage");

// Settings Elements
const btnSettings = document.getElementById("btnSettings");
const settingsModal = document.getElementById("settingsModal");
const apiKeyInput = document.getElementById("apiKeyInput");
const btnSaveSettings = document.getElementById("btnSaveSettings");
const btnCloseSettings = document.getElementById("btnCloseSettings");

let currentTab = null;
let attachedMedia = []; // Danh sách: { id, file, name, size, type, isAi, previewUrl }

// Khởi chạy khi mở popup
document.addEventListener("DOMContentLoaded", async () => {
  chrome.storage.local.get(["nvidiaApiKey", "savedDestination"], (res) => {
    const key = res.nvidiaApiKey || DEFAULT_API_KEY;
    apiKeyInput.value = key;
    if (res.savedDestination) {
      destinationInput.value = res.savedDestination;
    }
  });

  await checkCurrentTab();
  setupEvents();
  setupMediaEvents();
});

// Kiểm tra tab đang mở
async function checkCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;
  currentTab = tabs[0];

  const url = currentTab.url || "";
  if (!url.includes("reddit.com")) {
    setStatus("red", "Bạn chưa mở Reddit.", true, "Mở Reddit", () => {
      chrome.tabs.create({ url: "https://www.reddit.com/r/test/submit" });
    });
    return;
  }

  if (url.includes("/submit")) {
    setStatus("green", "Đang ở trang đăng bài Reddit. Sẵn sàng!", false);
  } else {
    setStatus("yellow", "Đang ở Reddit (chưa vào trang tạo bài).", true, "Đến trang Submit", () => {
      goToSubmitPage();
    });
  }
}

function setStatus(color, text, showBtn = false, btnText = "", btnAction = null) {
  statusDotEl.className = `dot ${color}`;
  statusTextEl.textContent = text;
  if (showBtn) {
    btnGoSubmit.textContent = btnText;
    btnGoSubmit.classList.remove("hidden");
    btnGoSubmit.onclick = btnAction;
  } else {
    btnGoSubmit.classList.add("hidden");
  }
}

function goToSubmitPage() {
  const dest = destinationInput.value.trim() || "r/test";
  let submitUrl = "https://www.reddit.com/r/test/submit";
  if (dest.startsWith("u/")) {
    submitUrl = `https://www.reddit.com/user/${dest.slice(2)}/submit`;
  } else if (dest.startsWith("r/")) {
    submitUrl = `https://www.reddit.com/r/${dest.slice(2)}/submit`;
  } else {
    submitUrl = `https://www.reddit.com/r/${dest}/submit`;
  }
  chrome.tabs.update(currentTab.id, { url: submitUrl });
  window.close();
}

function setupEvents() {
  btnSettings.onclick = () => settingsModal.classList.remove("hidden");
  btnCloseSettings.onclick = () => settingsModal.classList.add("hidden");
  btnSaveSettings.onclick = () => {
    const key = apiKeyInput.value.trim() || DEFAULT_API_KEY;
    chrome.storage.local.set({ nvidiaApiKey: key }, () => {
      settingsModal.classList.add("hidden");
      showToast("Đã lưu API Key thành công!", "success");
    });
  };

  destinationInput.oninput = () => {
    chrome.storage.local.set({ savedDestination: destinationInput.value.trim() });
  };

  btnGenerate.onclick = handleGenerateAI;
  btnPublish.onclick = handlePublish;
}

// =========================================================================
// Quản lý Media (Ảnh & Video)
// =========================================================================
function setupMediaEvents() {
  btnUploadMedia.onclick = () => mediaFileInput.click();

  mediaFileInput.onchange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      addMediaFiles(e.target.files, false);
      mediaFileInput.value = "";
    }
  };

  btnAiImage.onclick = handleAiImage;

  mediaDropzone.onclick = (e) => {
    if (e.target === mediaDropzone || e.target.closest("#mediaEmptyNotice")) {
      mediaFileInput.click();
    }
  };

  mediaDropzone.ondragover = (e) => {
    e.preventDefault();
    mediaDropzone.classList.add("dragover");
  };

  mediaDropzone.ondragleave = (e) => {
    e.preventDefault();
    mediaDropzone.classList.remove("dragover");
  };

  mediaDropzone.ondrop = (e) => {
    e.preventDefault();
    mediaDropzone.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addMediaFiles(e.dataTransfer.files, false);
    }
  };
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function addMediaFiles(files, isAi = false) {
  if (!files || files.length === 0) return;
  let addedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      showMediaStatus(`Tệp "${file.name}" không phải ảnh hoặc video hợp lệ!`, "error");
      continue;
    }
    if (file.size > 50 * 1024 * 1024) {
      showMediaStatus(`Tệp "${file.name}" vượt quá 50MB!`, "error");
      continue;
    }

    const previewUrl = URL.createObjectURL(file);
    attachedMedia.push({
      id: "media_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      file: file,
      name: file.name,
      size: formatFileSize(file.size),
      type: file.type,
      isAi: isAi,
      previewUrl: previewUrl
    });
    addedCount++;
  }

  renderMediaPreviews();
  if (addedCount > 0 && !isAi) {
    showMediaStatus(`Đã thêm ${addedCount} tệp thành công!`, "success");
  }
}

function removeMedia(id) {
  const index = attachedMedia.findIndex(m => m.id === id);
  if (index !== -1) {
    try {
      URL.revokeObjectURL(attachedMedia[index].previewUrl);
    } catch (e) {}
    attachedMedia.splice(index, 1);
    renderMediaPreviews();
    showMediaStatus("", "hidden");
  }
}

function renderMediaPreviews() {
  mediaCount.textContent = `${attachedMedia.length} tệp`;

  if (attachedMedia.length === 0) {
    mediaEmptyNotice.classList.remove("hidden");
    mediaPreviewList.classList.add("hidden");
    mediaPreviewList.innerHTML = "";
    return;
  }

  mediaEmptyNotice.classList.add("hidden");
  mediaPreviewList.classList.remove("hidden");
  mediaPreviewList.innerHTML = "";

  attachedMedia.forEach(item => {
    const card = document.createElement("div");
    card.className = "media-card";

    if (item.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = item.previewUrl;
      img.alt = item.name;
      card.appendChild(img);
    } else {
      const vid = document.createElement("video");
      vid.src = item.previewUrl;
      vid.muted = true;
      card.appendChild(vid);
    }

    // Nút xóa ✕
    const btnRemove = document.createElement("button");
    btnRemove.className = "media-btn-remove";
    btnRemove.innerHTML = "✕";
    btnRemove.title = "Xóa tệp này";
    btnRemove.onclick = (e) => {
      e.stopPropagation();
      removeMedia(item.id);
    };
    card.appendChild(btnRemove);

    // AI Badge
    if (item.isAi) {
      const badge = document.createElement("span");
      badge.className = "media-ai-badge";
      badge.textContent = "AI";
      card.appendChild(badge);
    }

    // Size badge
    const sizeBadge = document.createElement("span");
    sizeBadge.className = "media-size-badge";
    sizeBadge.textContent = item.size;
    card.appendChild(sizeBadge);

    mediaPreviewList.appendChild(card);
  });
}

function showMediaStatus(msg, type) {
  if (!msg || type === "hidden") {
    mediaStatusMessage.className = "result-message hidden";
    mediaStatusMessage.textContent = "";
    return;
  }
  let extraClass = type === "loading" ? "success" : type;
  mediaStatusMessage.className = `result-message ${extraClass}`;
  mediaStatusMessage.textContent = msg;
}

// Tạo ảnh minh họa bằng AI qua Pollinations.ai FLUX (hoàn toàn miễn phí, chất lượng cao)
async function handleAiImage() {
  const customPrompt = aiImagePromptInput.value.trim();
  const title = postTitle.value.trim();
  const prompt = promptInput.value.trim();

  const targetSubject = customPrompt || title || prompt;

  if (!targetSubject) {
    aiPromptRow.classList.remove("hidden");
    aiImagePromptInput.focus();
    showMediaStatus("Vui lòng nhập mô tả ảnh muốn vẽ hoặc tạo Tiêu đề bài viết trước!", "error");
    return;
  }

  setLoading(btnAiImage, true);
  showMediaStatus("🎨 Dino AI đang vẽ ảnh minh họa (khoảng 10-15 giây)...", "loading");

  try {
    const enhancedPrompt = `${targetSubject}, vivid digital art, colorful illustration, highly detailed, sharp focus, 4k`;
    const encoded = encodeURIComponent(enhancedPrompt);
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=768&nologo=true&model=flux&seed=${seed}`;

    const res = await fetch(imageUrl);
    if (!res.ok) {
      throw new Error(`Máy chủ tạo ảnh phản hồi HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const fileName = `dino-art-${Date.now()}.jpg`;
    const file = new File([blob], fileName, { type: "image/jpeg", lastModified: Date.now() });

    addMediaFiles([file], true);
    showMediaStatus("✅ Đã tạo ảnh AI thành công và đính kèm vào bài viết!", "success");
    aiPromptRow.classList.add("hidden");
  } catch (err) {
    showMediaStatus(`Lỗi khi tạo ảnh AI: ${err.message}`, "error");
  } finally {
    setLoading(btnAiImage, false);
  }
}

// Chuyển File thành Base64 Data URL để truyền qua executeScript
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// Gọi MiniMax M3.1 Flash để sinh văn bản bài viết
async function handleGenerateAI() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    showAIStatus("Vui lòng nhập yêu cầu cho AI vào ô trên!", "error");
    return;
  }

  setLoading(btnGenerate, true);
  showAIStatus("🦖 Dino đang suy nghĩ và viết bài (khoảng 15-25 giây)...", "loading");

  try {
    const res = await chrome.storage.local.get(["nvidiaApiKey"]);
    const apiKey = res.nvidiaApiKey || DEFAULT_API_KEY;

    const systemPrompt = `You are Dino, an expert Reddit social writing assistant. Help draft a compelling Reddit text post based on user prompt.
You MUST output ONLY a valid JSON object (no markdown code fence, no reasoning outside JSON):
{
  "title": "A short, engaging title in Vietnamese (under 150 characters)",
  "body": "The detailed post content in Vietnamese",
  "message": "A brief friendly reply to user in Vietnamese"
}`;

    const response = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Hãy viết bài đăng cho Reddit với chủ đề: ${prompt}` }
        ],
        temperature: 0.6,
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      throw new Error(`Lỗi kết nối AI (HTTP ${response.status}). Vui lòng kiểm tra API Key.`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Mô hình AI chưa trả về định dạng bài đăng hợp lệ. Vui lòng thử lại!");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.title) postTitle.value = parsed.title;
    if (parsed.body) postBody.value = parsed.body;

    showAIStatus(parsed.message || "✅ Đã tạo tiêu đề & nội dung xong! Hãy xem bên dưới.", "success");
  } catch (err) {
    showAIStatus(`Không thể tạo bài: ${err.message}`, "error");
  } finally {
    setLoading(btnGenerate, false);
  }
}

function showAIStatus(msg, type) {
  if (!msg || type === "hidden") {
    aiStatusMessage.className = "result-message hidden";
    aiStatusMessage.textContent = "";
    return;
  }
  let extraClass = type === "loading" ? "success" : type;
  aiStatusMessage.className = `result-message ${extraClass}`;
  aiStatusMessage.textContent = msg;
}

// =========================================================================
// Hàm chạy trực tiếp trong trang Reddit (/submit)
// =========================================================================
async function fillAndPostInPage(title, body, autoSubmit, mediaPayloads = []) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  if (!window.location.pathname.includes("/submit")) {
    return {
      success: false,
      error: "Vui lòng mở trang đăng bài Reddit (/submit) trước khi điền!"
    };
  }

  // 1. Quét toàn bộ DOM kể cả các Shadow Root
  const all = [];
  function visit(root) {
    if (!root) return;
    const els = root.querySelectorAll('*');
    for (let i = 0; i < els.length; i++) {
      all.push(els[i]);
      if (els[i].shadowRoot) visit(els[i].shadowRoot);
    }
  }
  visit(document);

  // Hàm kiểm tra phần tử có đang thực sự hiển thị trên màn hình không
  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  };

  // 2. TÌM VÀ ĐIỀN Ô TIÊU ĐỀ (Title)
  let titleEl = all.find(el => {
    if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') return false;
    const label = (el.getAttribute('name') || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('tìm kiếm') || label.includes('search') || label === 'q') return false;
    if (el.closest('header, nav, [role="search"], [role="navigation"]')) return false;
    return (label.includes('title') || label.includes('tiêu đề')) && isVisible(el);
  });

  if (!titleEl) {
    titleEl = all.find(el => {
      if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') return false;
      const label = (el.getAttribute('name') || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('tìm kiếm') || label.includes('search') || label === 'q') return false;
      if (el.closest('header, nav, [role="search"], [role="navigation"]')) return false;
      return isVisible(el);
    });
  }

  if (!titleEl) {
    return { success: false, error: "Không tìm thấy ô nhập Tiêu đề trên trang Reddit." };
  }

  // Điền Tiêu đề
  titleEl.focus();
  const setter = Object.getOwnPropertyDescriptor(titleEl, 'value')?.set || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(titleEl), 'value')?.set;
  if (setter) setter.call(titleEl, title);
  else titleEl.value = title;
  titleEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  titleEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  titleEl.blur();
  await sleep(150);

  // 3. TÌM VÀ ĐIỀN Ô NỘI DUNG (Body)
  // Kích hoạt placeholder nếu ô nội dung đang thu gọn
  const placeholderTarget = all.find(el => {
    if (el === titleEl) return false;
    const ph = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '').toLowerCase();
    const txt = (el.children.length === 0 ? el.textContent || '' : '').toLowerCase().trim();
    return (ph.includes('văn bản') || txt === 'phần văn bản chính (không bắt buộc)' || txt === 'phần văn bản chính' || txt === 'body text (optional)') && isVisible(el);
  });

  if (placeholderTarget) {
    try {
      placeholderTarget.focus?.();
      placeholderTarget.click?.();
      await sleep(150);
      all.length = 0;
      visit(document);
    } catch (e) {}
  }

  let bodyEl = all.find(el => {
    if (el === titleEl) return false;
    if (el.tagName === 'BODY' || el.tagName === 'HTML' || el.tagName === 'MAIN') return false;
    const ph = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
    const isEdit = el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true' || el.isContentEditable;
    return isEdit && (ph.includes('văn bản') || ph.includes('body')) && isVisible(el);
  });

  if (!bodyEl) {
    bodyEl = all.find(el => {
      if (el === titleEl) return false;
      if (el.tagName === 'BODY' || el.tagName === 'HTML' || el.tagName === 'MAIN' || el.tagName === 'FORM') return false;
      if (el.tagName === 'INPUT' && el.getAttribute('type') !== 'text') return false;

      const label = (el.getAttribute('name') || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('tìm kiếm') || label.includes('search') || label === 'q') return false;
      if (el.closest('header, nav, [role="search"], [role="navigation"], shreddit-search-bar, faceplate-search-input')) return false;

      const isContentEditable = el.getAttribute('contenteditable') === 'true' || el.isContentEditable === true;
      const isLexicalOrRte = el.hasAttribute('data-lexical-editor') || el.classList.contains('ProseMirror');
      const isTextArea = el.tagName === 'TEXTAREA';
      const isTextboxRole = el.getAttribute('role') === 'textbox';

      return (isContentEditable || isLexicalOrRte || isTextArea || isTextboxRole) && isVisible(el);
    });
  }

  let bodyFilled = false;

  if (body && body.trim().length > 0 && bodyEl) {
    bodyEl.scrollIntoView({ block: 'center', inline: 'center' });
    bodyEl.focus();
    bodyEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    bodyEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    bodyEl.click();
    await sleep(150);

    // TH 1: Thẻ TEXTAREA (Markdown mode)
    if (bodyEl.tagName === 'TEXTAREA') {
      const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (taSetter) taSetter.call(bodyEl, body);
      else bodyEl.value = body;
      bodyEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      bodyEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      await sleep(150);
      bodyFilled = (bodyEl.value || '').trim().length > 0;
    } else {
      // TH 2: ContentEditable (Rich Text mode)
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(bodyEl);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      // execCommand
      try {
        document.execCommand('insertText', false, body);
        await sleep(100);
      } catch (e) {}

      // ClipboardEvent
      let cur = (bodyEl.innerText || bodyEl.textContent || '').trim();
      if (!cur || cur.length < 3) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', body);
          dt.setData('text/html', `<p>${body.replace(/\n/g, '<br>')}</p>`);
          const pasteEvt = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
            composed: true
          });
          bodyEl.dispatchEvent(pasteEvt);
          await sleep(100);
        } catch (e) {}
      }

      // beforeinput
      cur = (bodyEl.innerText || bodyEl.textContent || '').trim();
      if (!cur || cur.length < 3) {
        try {
          const beforeInput = new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: body,
            bubbles: true,
            cancelable: true,
            composed: true
          });
          bodyEl.dispatchEvent(beforeInput);
          await sleep(100);
        } catch (e) {}
      }

      bodyEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: body }));
      bodyEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      const verifiedText = (bodyEl.innerText || bodyEl.textContent || '').trim();
      bodyFilled = verifiedText.length >= 3;
    }
  }

  // 4. ĐÍNH KÈM HÌNH ẢNH & VIDEO (MEDIA) VÀO REDDIT
  let mediaAttachedCount = 0;
  if (mediaPayloads && mediaPayloads.length > 0) {
    all.length = 0;
    visit(document);

    // Tái tạo các đối tượng File W3C chuẩn từ Base64
    const reconstructedFiles = mediaPayloads.map(p => {
      const commaIdx = p.base64.indexOf(',');
      const b64Data = commaIdx >= 0 ? p.base64.slice(commaIdx + 1) : p.base64;
      const byteCharacters = atob(b64Data);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      return new File([byteNumbers], p.name, { type: p.type, lastModified: p.lastModified });
    });

    const dt = new DataTransfer();
    for (const f of reconstructedFiles) {
      dt.items.add(f);
    }

    // Cách 1: Tìm input[type="file"] trong trang / shadow DOM
    const fileInputs = all.filter(el => {
      if (el.tagName !== 'INPUT' || el.type !== 'file') return false;
      if (el.closest('header, nav, shreddit-user-drawer')) return false;
      return true;
    });

    if (fileInputs.length > 0) {
      for (const fi of fileInputs) {
        try {
          fi.files = dt.files;
          fi.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          fi.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          mediaAttachedCount = reconstructedFiles.length;
        } catch (e) {}
      }
    }

    // Cách 2: Nếu có nút hình ảnh/video trên thanh công cụ soạn thảo, bấm để kích hoạt file picker ngầm
    const toolbarMediaBtn = all.find(el => {
      if (!el.matches('button, [role="button"]')) return false;
      const aria = (el.getAttribute('aria-label') || el.title || '').toLowerCase();
      return (aria.includes('ảnh') || aria.includes('image') || aria.includes('media') || aria.includes('video')) && isVisible(el);
    });

    // Cách 3: Bắn ClipboardEvent paste tệp vào bodyEl
    if (bodyEl) {
      try {
        bodyEl.focus();
        const pasteEvt = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
          composed: true
        });
        bodyEl.dispatchEvent(pasteEvt);
        mediaAttachedCount = reconstructedFiles.length;
      } catch (e) {}
    }

    // Cách 4: Bắn DragEvent drop tệp vào dropzone / bodyEl
    const dropTarget = all.find(el => {
      const txt = (el.innerText || '').toLowerCase();
      return isVisible(el) && (txt.includes('kéo') || txt.includes('drag') || txt.includes('thả'));
    }) || bodyEl;

    if (dropTarget) {
      try {
        const dropEvt = new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          composed: true
        });
        dropTarget.dispatchEvent(dropEvt);
        mediaAttachedCount = reconstructedFiles.length;
      } catch (e) {}
    }

    // Chờ 1.5s để Reddit tải xong ảnh/video preview
    await sleep(1500);
  }

  // 5. KIỂM TRA BẢO VỆ NẾU CHỌN TỰ ĐỘNG ĐĂNG
  if (autoSubmit) {
    if (body && body.trim().length > 0 && !bodyFilled) {
      return {
        success: false,
        error: "⚠️ Đã điền xong Tiêu đề, nhưng chưa điền được Nội dung vào Reddit. Vui lòng bấm chuột vào ô 'phần văn bản chính' trên trang Reddit rồi thử lại!"
      };
    }

    let postBtn = null;
    // Chờ tối đa 5 giây cho nút Đăng kích hoạt (phòng khi Reddit đang tải tệp media lên)
    for (let wait = 0; wait < 12; wait++) {
      all.length = 0;
      visit(document);

      postBtn = all.find(b => {
        if (!b.matches('button, [role="button"], shreddit-button, reddit-button')) return false;
        if (b.id === 'inner-post-submit-button') return true;
        const txt = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return (txt === 'post' || txt === 'đăng' || txt === 'submit post' || txt.includes('đăng bài')) && isVisible(b);
      });

      if (postBtn && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
        break;
      }
      await sleep(400);
    }

    if (postBtn && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
      postBtn.focus();
      postBtn.click();
      await sleep(1500);

      const mediaMsg = mediaPayloads.length > 0 ? ` kèm ${mediaPayloads.length} ảnh/video` : "";
      return {
        success: true,
        submitted: true,
        message: `🎉 Đã tự động điền Tiêu đề, Nội dung${mediaMsg} và bấm nút Đăng thành công!`
      };
    } else {
      const mediaMsg = mediaPayloads.length > 0 ? ` kèm ${mediaPayloads.length} ảnh/video` : "";
      return {
        success: true,
        submitted: false,
        message: `✅ Đã điền xong Tiêu đề, Nội dung${mediaMsg}! Nút Đăng đang khóa (có thể cần chọn Flair/Thẻ). Bạn hãy chọn Thẻ rồi bấm 'Đăng' nhé.`
      };
    }
  }

  // Mặc định (khi không chọn tự động bấm Đăng):
  const mediaNotice = mediaPayloads.length > 0 ? ` và tải lên ${mediaPayloads.length} tệp media` : "";
  return {
    success: true,
    submitted: false,
    message: bodyFilled 
      ? `✅ Đã điền xong cả Tiêu đề, Nội dung${mediaNotice} vào trang Reddit! Bạn hãy kiểm tra lại rồi bấm 'Đăng' nhé.`
      : `✅ Đã điền xong Tiêu đề${mediaNotice}! Ô nội dung cũng đã được lưu sẵn vào Clipboard (bạn chỉ việc click vào ô nội dung và nhấn Ctrl+V là xong).`
  };
}

// Bấm nút Điền vào Reddit & Đăng bài
async function handlePublish() {
  const title = postTitle.value.trim();
  const body = postBody.value.trim();
  const autoSubmit = chkAutoSubmit.checked;

  if (!title) {
    showToast("Vui lòng nhập hoặc tạo Tiêu đề bài viết trước!", "error");
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;
  const tab = tabs[0];

  if (!tab.url.includes("reddit.com/")) {
    showToast("Vui lòng mở một tab Reddit trước khi bấm đăng!", "error");
    return;
  }

  if (!tab.url.includes("/submit")) {
    showToast("Đang chuyển bạn đến trang soạn bài Reddit...", "success");
    goToSubmitPage();
    return;
  }

  // Luôn sao chép nội dung bài viết vào Clipboard để người dùng có thể Ctrl+V ngay lập tức
  if (body) {
    try {
      await navigator.clipboard.writeText(body);
    } catch (e) {}
  }

  setLoading(btnPublish, true);
  showToast("", "hidden");

  // Chuẩn bị payload media nếu có
  let mediaPayloads = [];
  if (attachedMedia.length > 0) {
    try {
      showToast("Đang chuẩn bị ảnh & video đính kèm...", "loading");
      mediaPayloads = await Promise.all(attachedMedia.map(async item => {
        const base64 = await fileToBase64(item.file);
        return {
          name: item.name,
          type: item.type,
          lastModified: item.file.lastModified || Date.now(),
          base64: base64
        };
      }));
    } catch (e) {
      console.warn("Không thể mã hóa file media:", e);
    }
  }

  try {
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: fillAndPostInPage,
        args: [title, body, autoSubmit, mediaPayloads]
      });
    } catch (mainWorldErr) {
      console.warn("Execute in MAIN world failed, trying default:", mainWorldErr);
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillAndPostInPage,
        args: [title, body, autoSubmit, mediaPayloads]
      });
    }

    setLoading(btnPublish, false);
    const response = results?.[0]?.result;

    if (response && response.success) {
      showToast(response.message, "success");
    } else {
      showToast(`Lỗi: ${response?.error || "Không thể tương tác form."}`, "error");
    }
  } catch (err) {
    setLoading(btnPublish, false);
    showToast(`Lỗi: ${err.message}`, "error");
  }
}

function setLoading(button, isLoading) {
  const text = button.querySelector(".btn-text");
  const spinner = button.querySelector(".spinner");
  button.disabled = isLoading;
  if (isLoading) {
    text?.classList.add("hidden");
    spinner?.classList.remove("hidden");
  } else {
    text?.classList.remove("hidden");
    spinner?.classList.add("hidden");
  }
}

function showToast(msg, type) {
  if (!msg || type === "hidden") {
    resultMessage.className = "result-message hidden";
    resultMessage.textContent = "";
    return;
  }
  let extraClass = type === "loading" ? "success" : type;
  resultMessage.className = `result-message ${extraClass}`;
  resultMessage.textContent = msg;
}
