# DinoPost

A social publishing assistant for Reddit powered by **MiniMax M3.1 Flash AI**. DinoPost supports two deployment modes:

1. **Chrome Extension (Manifest V3 - Recommended)**: Located in [`extension/`](extension/). Runs directly inside your daily, active Google Chrome browser window. Bypasses separate profile restrictions, works seamlessly with Cloudflare WARP / local network setups, and automates Reddit post drafting and publishing with full Title, Body, Local Images/Videos, and AI Image Generation support.
2. **Windows Desktop App**: Built with **Rust, Tauri 2, React and TypeScript**. Discuss a post with MiniMax, review the exact content and Reddit destination, then confirm. JEV chooses browser actions from structured DOM data while Rust drives the installed Google Chrome app.

---

## 🌟 Quick Start with Chrome Extension (Recommended)

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (top-right corner).
3. Click **Load unpacked** (top-left corner) and select the `extension/` folder in this repository.
4. Pin the **DinoPost AI** extension, configure your NVIDIA API key in **Settings (⚙️)**, and start drafting/posting on Reddit directly!

See [`extension/README.md`](extension/README.md) for full extension documentation.

---

## Run on Windows

Prerequisites: Node.js 22.12+ (or a newer supported version), Rust with the MSVC toolchain, Visual Studio C++ Build Tools, Microsoft Edge WebView2 Runtime, and Google Chrome. Tauri uses WebView2 for its interface; publishing opens the separate Google Chrome app.

```powershell
cd D:\Project\Deeplearning-project\DinoPost
npm ci
npm run desktop
```

Configure API keys in **Settings**. They are stored in Windows Credential Manager and never returned to the frontend. For development, copy `.env.example` to `.env` and set `NVIDIA_API_KEY` and `TYPESAFE_API_KEY`. Environment variables override Credential Manager, which overrides `.env`. Restart after changing `.env`. Never use the `VITE_` prefix for keys.

In this workspace, both keys from the supplied local guide have been saved in Windows Credential Manager. A gitignored `.env` is also present for development. Neither it nor the guide is bundled in the executable. Keep the guide out of commits and releases.

```powershell
npm run desktop:build
```

The standalone executable is `src-tauri/target/release/dinopost.exe`. The NSIS installer is generated under `src-tauri/target/release/bundle/nsis/`. This foundation release is unsigned.

`npm run dev` serves a **UI preview** at http://127.0.0.1:1420. Native features require the desktop app; the web preview never pretends to connect or publish.

## First Reddit test

1. Open **Connections → Open Chrome & connect**. DinoPost discovers the installed Chrome executable.
2. If asked, sign into Reddit manually in the DinoPost Chrome window. DinoPost detects sign-in automatically; there is no separate connection-check button. It does not type passwords or solve login challenges.
3. The initial title in **Create a post** is exactly **Today is the great day**; the body is empty. The initial destination is **r/test**. Change it to a community you can post to, or `u/your-username` for your own profile. Profile destinations must match the logged-in account.
4. Chat with Dino to revise the post, or use **Edit draft**. Review all content and the destination.
5. Click **Confirm & publish**. DinoPost saves and approves that exact revision, checks login, opens the destination’s text composer, and asks JEV to choose among validated operations.
6. If logged out, DinoPost keeps the draft and pauses. Log in in Chrome, then click **I’ve logged in · continue** to resume.
7. Once the approved fields and destination match, Rust directly clicks the enabled Post button, including Reddit's nested Lit span markup and open shadow roots. This final click does not need another JEV decision. Success requires a Reddit comments permalink under the approved destination plus matching title and body. The permalink is saved with the draft and shown in the preview.

Chrome 136+ restricts debugging the default Chrome data directory. DinoPost uses the installed Chrome executable with a persistent profile at `%LOCALAPPDATA%\app.dinopost.desktop\chrome-profile`. **It does not inherit the session from ordinary Chrome.** Log in once in this profile; future launches reuse that session. It does not copy cookies or close your other Chrome windows. Only its owned Reddit tab is controlled. See [Chrome’s remote-debugging changes](https://developer.chrome.com/blog/remote-debugging-port).

After the initial connection, Chrome opens automatically alongside DinoPost on startup. Sign-in and verification status update automatically while you finish connecting. If you close Chrome, DinoPost leaves it closed; it opens again when you confirm a post. Background sign-in checks never relaunch a closed browser.

## Chat history

Use **New chat** for a fresh conversation. **Chat history** lists saved conversations, and the sidebar shows recent chats. Selecting a chat restores its messages and draft. Each conversation has separate model context and draft ownership. Existing messages and drafts from earlier builds migrate into the first saved chat, and the selected chat survives restarts. Manual draft edits are saved before switching chats. Conversation history stays in the local SQLite database.

## Model split

| Component | Responsibility | Input |
| --- | --- | --- |
| MiniMax M3.1 Flash | Conversation, recommendations, rewriting | Bounded text history and current draft |
| JEV (`jev-latest`) | Choose the next allowed form operation | Compact page text, approved content, offered controls, recent actions |
| Rust executor | Login, Chrome connection, exact field values, guards, submission, verification | Validated typed decisions |

MiniMax uses `https://integrate.api.nvidia.com/v1/chat/completions` with `minimaxai/minimax-m3.1-flash`, following the supplied guide. JEV uses `https://api.typesafe.ai/v1/systemone`. **There is no screenshot capture or image-model loop.** Rust types the approved title and body directly, without asking another model to regenerate them. JEV cannot supply JavaScript, selectors, coordinates, arbitrary URLs, or shell commands. Its choice and probability distribution are validated against the offered actions. Low-confidence decisions stop the workflow.

This reduces repeated LLM calls and image input; actual cost and latency depend on providers and page behavior. No savings percentage is assumed.

## Architecture

```text
React interface
  └─ typed Tauri commands
      ├─ MiniMax content provider (Rust HTTP)
      ├─ SQLite chat sessions, drafts, revisions, messages and activity
      ├─ Windows Credential Manager / local development config
      └─ approval-bound Reddit workflow
          ├─ Chrome discovery + persistent profile
          ├─ loopback Chrome DevTools Protocol connection
          ├─ DOM reader, including open shadow roots
          ├─ JEV typed decision provider
          └─ guarded native input + independent outcome verification
```

Main sources: `src/App.tsx` (UI), `src-tauri/src/lib.rs` (commands/workflow), `browser.rs` and `snapshot.js` (Chrome/DOM), `providers.rs` (model adapters), `store.rs` (SQLite), `config.rs` (keys), and `domain.rs` (validation).

Draft states:

```text
draft → running → submitting → published
            ├─ waiting_login → running (explicit resume)
            └─ blocked → running (explicit retry)
                      submitting → uncertain (unverified outcome)
```

Approval binds the stored revision, title, body and destination. Editing creates a new revision. Atomic database updates reject stale revisions, concurrent approval and repeat submission. The executor rechecks live form values immediately before submitting. It writes `submitting` **before** clicking: a crash or ambiguous response prevents a second attempt. Restart recovery converts interrupted submissions to `uncertain`. Check Chrome manually before making another draft in that case.

Both the composer URL and its visible destination picker must match the approved destination. If a changed Reddit layout prevents the picker from being read, the workflow stops. V1 does not guess the destination.

SQLite lives at `%LOCALAPPDATA%\app.dinopost.desktop\dinopost.sqlite3`. Drafts and conversation are local plaintext data. Keys use the OS credential store. Draft/conversation text is sent to NVIDIA during chat; page text is sent to TypeSafe during confirmed posting. Chrome passwords and cookies are not exported.

## Verification

```powershell
npm run build
npm test
npm run test:rust
```

Playwright uses installed Chrome to test the UI and DOM reader with a local intercepted HTML fixture. These checks do not post to Reddit or call either model. Set `DINOPOST_CHROME_PATH` if Chrome is installed elsewhere. Rust tests cover destination/origin validation, JEV answer validation, revision-bound approvals, login resume, duplicate rejection and permalink/content verification.

An optional paid TypeSafe contract test is excluded from the regular suite:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml live_jev_contract --lib -- --ignored
```

For local desktop diagnostics, start the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` and run `node scripts/inspect-desktop.mjs`. Add `--check-browser` to open Chrome and check Reddit. Keep debugging disabled during ordinary use.

Live model checks consume provider credits. A real Reddit publication requires a logged-in account and a human click on the app’s confirmation button. Passing builds and fixture tests are not evidence of a successful live publication.

## Foundation limits

V1 supports Reddit text posts, one task at a time. It stops for unsupported composer layouts, mandatory flair/rules, CAPTCHA, access restrictions, rate limits or low-confidence decisions. There are no uploads, scheduling, proxies, anti-ban guarantees, or Facebook/Instagram publishing yet. The workflow is limited to 20 steps and never automatically repeats a submit.

## References

Local reference repositories were reviewed for patterns; they are not runtime dependencies and were not vendored into the application.

- [browser-use](https://github.com/browser-use/browser-use): structured observations, browser sessions and guarded actions.
- [jev-ultrafast](https://github.com/browser-use/jev-ultrafast): compact DOM state and typed JEV decisions.
- [Hermes Agent](https://github.com/NousResearch/hermes-agent): conversational agent workflows and local state.
- [Postiz](https://github.com/gitroomhq/postiz-app): draft/publish separation and uncertain-submit handling. Its Reddit adapter uses OAuth; DinoPost v1 follows the requested Chrome workflow.
- [Tauri 2](https://v2.tauri.app/start/) and [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice): native shell and decision API contracts.
