# DinoPost AI · Chrome extension

The active development path is the Manifest V3 side panel on `develop`. It runs in the user's existing Chrome profile and Reddit session. It does not start a second browser, copy cookies, or need CDP. Reusing a logged-in session does **not** guarantee that Reddit will stop blocking requests. Login, CAPTCHA, subreddit rules, and the final Post click remain with the user.

## Install or reload

1. Open `chrome://extensions/` in your ordinary Chrome profile.
2. Enable Developer mode, choose **Load unpacked**, and select this repository's `extension` directory (in this workspace: `D:\Project\Deeplearning-project\DinoPost\extension`). If already loaded, click **Reload** after updates and reopen the side panel.
3. Pin DinoPost and click its icon to open the persistent side panel.
4. Open Settings and enter the NVIDIA API key. The desktop `.env` and Windows Credential Manager are separate; the extension does not import their keys.
5. Optionally add a brand profile and real writing samples / voice guide. Personal test drafts can use facts supplied in chat without a brand setup interview.

## Chat → content → image → Reddit

1. Open Reddit in this Chrome profile and sign in / complete challenges yourself.
2. Chat with Dino. Ordinary questions produce replies without overwriting the draft. Requests to write or revise produce a title and body; revision requests receive the existing draft as context.
3. Ask MiniMax to create an image in chat. MiniMax decides when to call `generate_image` for that request and writes its visual brief; one image is allowed per turn. Alternatively use **Dino AI Vẽ ảnh** with a custom description, or upload a local image.
4. Review title, body, image and destination (`r/test` or `u/username`). The current test supports **one PNG, JPEG, GIF, or WebP up to 4 MiB**. A new image replaces the previous one. Video tools and uploads are disabled in this iteration.
5. Click **Điền bản nháp vào Reddit**. If needed the extension opens the matching text/image composer. Select the visible destination in Reddit and click Continue in the side panel. The visible picker and the URL must both match the draft destination; Reddit's trailing-slash redirects are accepted. The adapter supports a single dedicated file input, or one file paste into the verified rich-text editor when Reddit exposes multiple hidden upload inputs.
6. If login or CAPTCHA appears, complete it in Chrome and explicitly continue. No timer solves challenges or automatically resumes uploads. A form with an existing file stops instead of uploading a duplicate.
7. Review the real Reddit form, upload progress, caption, community rules and flair, then **click Post yourself**. Rich-text captions use one plain-text paste so paragraphs survive; validation normalizes the extra newlines and nonbreaking spaces introduced by Reddit's renderer. Image paste must produce a new visible image preview before preparation succeeds. DinoPost reports `prepared`, never `published`. It does not verify a published permalink in this version.

Chat history, draft fields, image bytes and image provenance persist in `chrome.storage.local`. There is one active conversation/draft; Clear starts a new local conversation. Closing the panel aborts in-flight work; completed attachments and the draft remain. Edits during generation cancel the old task so a stale answer cannot overwrite newer work. Only one generation or form operation runs at once.

## Pipeline and skills are separate

```text
popup/popup.js                 UI, draft persistence, cancellation, explicit user actions
  ├─ runtime/skills.js         load local, pinned editorial skills; verify SHA-256
  ├─ runtime/agent.js          MiniMax conversation and bounded native tool-call loop
  │    ├─ runtime/providers.js NVIDIA chat adapter
  │    └─ runtime/tools.js     allowlisted generate_image dispatcher (one execution/turn)
  │         └─ providers.js    Pollinations Classic image adapter
  └─ runtime/reddit.js         validated destination and deterministic composer preparation
skills/                       unchanged upstream SKILL.md, references and evals + MIT license
```

The runtime ships eight skills from [social-media-skills/skills](https://github.com/social-media-skills/skills), pinned to `f28cef2b7067ec64e79c9d85421c022c06659e03`: `brand-profile`, `voice-builder`, `writing-style-and-tone`, `hook-writer`, `text-post-and-microblog`, `caption-writer`, `reddit-marketing`, `image-prompt`.

Foundation, writing and Reddit guidance load before each model turn; the primary format skill switches between text and caption, and the image/caption guidance is also available when image tooling is enabled. The main SKILL.md documents are supplied to MiniMax. Reference files are packaged for inspection but are not automatically injected or claimed as read. Sibling skills outside this starter set and the upstream WoopSocial integrations are not executable capabilities. Reddit's skill is editorial/advisory; the extension's separate composer adapter leaves publication manual.

The model receives bounded text history, current title/body/destination, optional brand/voice context, and enabled native tool definitions. The image executor accepts only `{prompt}`; it rejects extra fields, unknown tools, video, multiple calls and repeated execution. The model cannot supply URLs, selectors, JavaScript or browser actions. The image receipt includes only attachment metadata; bytes and keys never enter tool messages. The tool loop is limited to three model responses, one image, and a shared 180-second cancellation deadline.

To refresh the vendored starter set deliberately, clone upstream at the pinned commit and run:

```powershell
node scripts/sync-extension-skills.mjs D:\path\to\social-media-skills
```

The script verifies the commit and records a SHA-256 manifest. Review and update the pin before adopting a newer upstream revision. There are no runtime downloads of skills or executable code.

## Providers and data

- **Text:** `minimaxai/minimax-m3.1-flash` at NVIDIA's chat-completions endpoint with native function calling. Only the final answer is parsed, never `reasoning_content`. Provider errors, incomplete answers and invalid drafts preserve existing content. Provider documentation: [NVIDIA MiniMax inference](https://docs.api.nvidia.com/nim/reference/minimaxai-minimax-m3-1-flash-infer).
- **Images:** [Pollinations Classic API](https://github.com/pollinations/pollinations/blob/master/APIDOCS.md), best effort and rate limited. Current Classic documentation specifies a single image model, a maximum area of 768×768, a visible Pollinations logo, and at least 45 seconds between free image requests. Do not assume the old `model=flux` or `nologo=true` options work. The adapter requests a square image, validates HTTP status / MIME / size, and the UI decodes actual image bytes. A 402/429 response is an error, never a successful attachment. No paid fallback, automatic retry, or video provider is enabled; local upload remains available.
- **Chrome storage:** keys and drafts are stored in the local Chrome profile, without application-level encryption. Storage access is restricted to trusted extension contexts. This is separate from the desktop credential store. No key is hardcoded or placed in a URL.
- **Data flow:** chat, draft and optional brand/voice context go to NVIDIA. Only the visual prompt goes to Pollinations. Classic images are cached by URL and are not suitable for confidential descriptions. The reviewed draft and image go to Reddit only on the user's Prepare action. Credentials and cookies are not exported. Media generation does not itself publish anything.

## Verification

```powershell
npm run test:extension       # unit contracts + intercepted browser fixtures, no external posts
npm run build               # existing desktop/frontend compatibility
npm test                    # full browser suite
```

The extension tests exercise skill hashes, chat versus revision behavior, native image-tool dispatch, failure handling, cancellation, image validation, persistence, shadow DOM, visible destination matching, CAPTCHA/login pauses, single-file attachment and the absence of automatic Post clicks. Browser fixture tests use an isolated test browser and mocked provider responses; they do not prove compatibility with a live Reddit layout or a successful live image request.

An opt-in provider integration test uses `NVIDIA_API_KEY` or the gitignored project `.env`, calls MiniMax and at most one image tool, and saves its report under `.local-tests/extension-live/` (separate from Playwright's cleaned output). It consumes provider quota and **never contacts Reddit**:

```powershell
npm run test:extension:live
```

After installing/reloading the extension, use the manual flow above to verify the current live Reddit composer. Unsupported or ambiguous layouts stop for manual preparation. Neither session reuse nor fixture tests are evidence that a public post was published.
