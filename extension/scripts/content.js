// scripts/content.js - Tự động điền và đăng bài Reddit trực tiếp trên tab hiện tại

console.log("[DinoPost AI] Content script đã sẵn sàng trên Reddit.");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "ping") {
    sendResponse({ status: "ok", url: window.location.href });
    return true;
  }
});
