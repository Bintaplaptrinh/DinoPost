// popup/popup.js - Điều khiển giao diện Extension và gọi MiniMax AI

const DEFAULT_API_KEY = ""; // Nhập NVIDIA API Key trong phần Cài đặt (⚙️) của Extension
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

// Settings Elements
const btnSettings = document.getElementById("btnSettings");
const settingsModal = document.getElementById("settingsModal");
const apiKeyInput = document.getElementById("apiKeyInput");
const btnSaveSettings = document.getElementById("btnSaveSettings");
const btnCloseSettings = document.getElementById("btnCloseSettings");

let currentTab = null;

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

// Gọi MiniMax M3.1 Flash
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
    if (!apiKey) {
      showAIStatus("Vui lòng cấu hình NVIDIA API Key trong phần Cài đặt (⚙️) trước khi dùng AI!", "error");
      settingsModal.classList.remove("hidden");
      setLoading(btnGenerate, false);
      return;
    }

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
async function fillAndPostInPage(title, body, autoSubmit) {
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

  // Tìm chính xác phần tử ô Thân bài đang HIỂN THỊ TRÊN MÀN HÌNH (isVisible)
  // Ưu tiên:
  // 1. Thẻ có placeholder chứa 'văn bản' hoặc 'body' (cả Textarea Markdown hoặc Contenteditable)
  // 2. Thẻ textarea hoặc contenteditable đang hiển thị bên dưới tiêu đề (loại trừ thanh tìm kiếm)
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

      // Thử execCommand
      try {
        document.execCommand('insertText', false, body);
        await sleep(100);
      } catch (e) {}

      // Thử dán ClipboardEvent
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

      // Thử beforeinput
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

  // 4. KIỂM TRA BẢO VỆ NẾU CHỌN TỰ ĐỘNG ĐĂNG
  if (autoSubmit) {
    if (body && body.trim().length > 0 && !bodyFilled) {
      return {
        success: false,
        error: "⚠️ Đã điền xong Tiêu đề, nhưng chưa điền được Nội dung vào Reddit. Vui lòng bấm chuột vào ô 'phần văn bản chính' trên trang Reddit rồi thử lại!"
      };
    }

    let postBtn = null;
    for (let wait = 0; wait < 8; wait++) {
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
      await sleep(350);
    }

    if (postBtn && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true') {
      postBtn.focus();
      postBtn.click();
      await sleep(1500);

      return {
        success: true,
        submitted: true,
        message: "🎉 Đã tự động điền Tiêu đề, Nội dung và bấm nút Đăng thành công!"
      };
    } else {
      return {
        success: true,
        submitted: false,
        message: "✅ Đã điền xong Tiêu đề và Nội dung! Nút Đăng đang khóa (có thể cần chọn Flair/Thẻ). Bạn hãy chọn Thẻ rồi bấm 'Đăng' nhé."
      };
    }
  }

  // Mặc định (khi không chọn tự động bấm Đăng):
  return {
    success: true,
    submitted: false,
    message: bodyFilled 
      ? "✅ Đã điền xong cả Tiêu đề và Nội dung vào trang Reddit! Bạn hãy kiểm tra lại rồi bấm 'Đăng' nhé."
      : "✅ Đã điền xong Tiêu đề! Ô nội dung cũng đã được lưu sẵn vào Clipboard (bạn chỉ việc click vào ô nội dung và nhấn Ctrl+V là xong)."
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

  try {
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: fillAndPostInPage,
        args: [title, body, autoSubmit]
      });
    } catch (mainWorldErr) {
      console.warn("Execute in MAIN world failed, trying default:", mainWorldErr);
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillAndPostInPage,
        args: [title, body, autoSubmit]
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
