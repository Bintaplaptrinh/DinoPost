// scripts/background.js - Service Worker xử lý chạy ngầm, Side Panel và lưu trữ trạng thái

const DEFAULT_API_KEY = "";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL_NAME = "minimaxai/minimax-m3.1-flash";

// 1. Cấu hình mở Side Panel khi nhấp vào biểu tượng tiện ích
function setupSidePanel() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn("Không thể bật openPanelOnActionClick:", err);
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupSidePanel();
  console.log("[DinoPost Background] Đã khởi tạo tiện ích.");
});

setupSidePanel();

// 2. Lắng nghe thông điệp từ popup / side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generateTextInBackground") {
    handleBackgroundTextGeneration(request.prompt, request.apiKey);
    sendResponse({ status: "started" });
    return true;
  }

  if (request.action === "generateImageInBackground") {
    handleBackgroundImageGeneration(request.targetSubject);
    sendResponse({ status: "started" });
    return true;
  }

  if (request.action === "openSidePanel") {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          chrome.sidePanel.open({ windowId: tabs[0].windowId }).catch((e) => console.warn(e));
        }
      });
    }
    sendResponse({ status: "ok" });
    return true;
  }
});

// 3. Xử lý sinh bài viết AI trong nền (Background)
async function handleBackgroundTextGeneration(prompt, customApiKey) {
  try {
    await chrome.storage.local.set({
      dinoAiTask: {
        status: "generating_text",
        type: "text",
        startTime: Date.now(),
        message: "🦖 Dino đang suy nghĩ và viết bài trong nền..."
      }
    });

    const apiKey = customApiKey || DEFAULT_API_KEY;
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
    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Mô hình AI chưa trả về định dạng bài đăng hợp lệ. Vui lòng thử lại!");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Cập nhật bản nháp đang lưu
    const storageData = await chrome.storage.local.get(["dinoDraft"]);
    const draft = storageData.dinoDraft || {};
    if (parsed.title) draft.title = parsed.title;
    if (parsed.body) draft.body = parsed.body;
    draft.updatedAt = Date.now();

    await chrome.storage.local.set({
      dinoDraft: draft,
      dinoAiTask: {
        status: "success",
        type: "text",
        message: parsed.message || "✅ Đã tạo tiêu đề & nội dung xong!",
        data: parsed
      }
    });

    // Thông báo badge trên icon tiện ích
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 6000);

  } catch (err) {
    await chrome.storage.local.set({
      dinoAiTask: {
        status: "error",
        type: "text",
        message: `Lỗi: ${err.message}`
      }
    });
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 6000);
  }
}

// 4. Xử lý tạo ảnh AI trong nền (Background)
async function handleBackgroundImageGeneration(targetSubject) {
  try {
    await chrome.storage.local.set({
      dinoAiTask: {
        status: "generating_image",
        type: "image",
        startTime: Date.now(),
        message: "🎨 Dino AI đang vẽ ảnh minh họa trong nền..."
      }
    });

    const enhancedPrompt = `${targetSubject}, vivid digital art, colorful illustration, highly detailed, sharp focus, 4k`;
    const encoded = encodeURIComponent(enhancedPrompt);
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=768&nologo=true&model=flux&seed=${seed}`;

    const res = await fetch(imageUrl);
    if (!res.ok) {
      throw new Error(`Máy chủ tạo ảnh phản hồi HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < uint8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunk));
    }
    const base64 = `data:${blob.type || "image/jpeg"};base64,` + btoa(binary);

    const fileName = `dino-art-${Date.now()}.jpg`;
    const mediaItem = {
      id: "media_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      name: fileName,
      size: (blob.size / 1024).toFixed(1) + " KB",
      type: "image/jpeg",
      isAi: true,
      base64: base64
    };

    const storageData = await chrome.storage.local.get(["dinoDraft"]);
    const draft = storageData.dinoDraft || {};
    const mediaList = draft.attachedMedia || [];
    mediaList.push(mediaItem);
    draft.attachedMedia = mediaList;
    draft.updatedAt = Date.now();

    await chrome.storage.local.set({
      dinoDraft: draft,
      dinoAiTask: {
        status: "success",
        type: "image",
        message: "✅ Đã tạo ảnh AI thành công và đính kèm vào bài viết!",
        mediaItem: mediaItem
      }
    });

    chrome.action.setBadgeText({ text: "🎨" });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 6000);

  } catch (err) {
    await chrome.storage.local.set({
      dinoAiTask: {
        status: "error",
        type: "image",
        message: `Lỗi khi tạo ảnh AI: ${err.message}`
      }
    });
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 6000);
  }
}
