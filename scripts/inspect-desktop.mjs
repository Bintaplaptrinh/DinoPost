// Development-only diagnostics. Start the desktop app with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223.
// Uses page CDP directly because some WebView2 versions expose shared workers
// without browserContextId, which generic Chromium clients cannot attach to.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const targets = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const target = targets.find(
  (t) =>
    t.type === "page" &&
    (t.url.includes("1420") || t.url.includes("tauri.localhost")),
);
if (!target)
  throw new Error("No DinoPost development WebView found on port 9223.");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let sequence = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const result = JSON.parse(data);
  const callback = pending.get(result.id);
  if (callback) {
    pending.delete(result.id);
    callback(result);
  }
};
async function call(method, params = {}) {
  const id = ++sequence;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("CDP request timed out."));
    }, 120_000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
async function invoke(name, args = {}) {
  const expression = `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`;
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ||
        "Desktop command failed.",
    );
  return result.result.value;
}
try {
  if (process.argv.includes("--seed-keys")) {
    const values = Object.fromEntries(
      readFileSync(".env", "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1)];
        }),
    );
    await invoke("save_settings", {
      nvidia: values.NVIDIA_API_KEY,
      typesafe: values.TYPESAFE_API_KEY,
    });
    console.log("Local provider keys saved to Windows Credential Manager.");
  }
  if (process.argv.includes("--check-browser"))
    console.log(JSON.stringify(await invoke("connect_reddit")));
  const state = await invoke("bootstrap");
  console.log(
    JSON.stringify({
      config: state.config,
      drafts: state.drafts.map((d) => ({
        title: d.title,
        destination: d.destination,
        status: d.status,
      })),
      messages: state.messages.length,
      chats: state.chats?.length,
      activeChatId: state.activeChatId,
      browser: state.browser?.status,
      browserLinked: state.browserLinked,
    }),
  );
  mkdirSync("test-results", { recursive: true });
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    "test-results/dinopost-native.png",
    Buffer.from(screenshot.data, "base64"),
  );
} finally {
  ws.close();
}
