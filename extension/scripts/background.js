// scripts/background.js - Service Worker cấu hình Side Panel cho DinoPost AI

function setupSidePanel() {
  // Provider keys and drafts must not be readable by Reddit content scripts.
  chrome.storage.local
    .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch(console.warn);
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => {
        console.warn("Không thể bật openPanelOnActionClick:", err);
      });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupSidePanel();
  console.log("[DinoPost Background] Đã khởi tạo tiện ích.");
});

setupSidePanel();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openSidePanel") {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          chrome.sidePanel
            .open({ windowId: tabs[0].windowId })
            .catch((e) => console.warn(e));
        }
      });
    }
    sendResponse({ status: "ok" });
    return true;
  }
});
