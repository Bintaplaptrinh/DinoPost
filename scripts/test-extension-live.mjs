// Opt-in integration test: provider credits/network only; never opens or posts to Reddit.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadSkills } from "../extension/runtime/skills.js";
import { runContentAgent } from "../extension/runtime/agent.js";

let key = process.env.NVIDIA_API_KEY;
if (!key) {
  const env = await readFile(new URL("../.env", import.meta.url), "utf8").catch(
    () => "",
  );
  key = env.match(/^NVIDIA_API_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
}
if (!key)
  throw new Error("Set NVIDIA_API_KEY or configure the local gitignored .env.");
const root = new URL("../.local-tests/extension-live/", import.meta.url);
await mkdir(root, { recursive: true });
const library = await loadSkills({
  fetchImpl: async (url) => new Response(await readFile(url)),
});
const attachments = [];
let requestedImage = false;
const signal = AbortSignal.timeout(180000);
const started = Date.now();
try {
  const output = await runContentAgent({
    prompt:
      "Create a short English Reddit test post about a FICTIONAL green dinosaur reading in a quiet library. Explicitly label the scene fictional and AI-generated. Also call generate_image once to create a matching original illustration. This is a local draft test only; do not publish.",
    draft: { title: "", body: "", destination: "r/test", hasMedia: false },
    allowImage: true,
    apiKey: key,
    library,
    signal,
    onEvent: (event) => {
      console.log(event.stage === "image_result" ? event.message : event.stage);
      if (event.stage === "image") requestedImage = true;
    },
    attachImage: async (image) => {
      signal.throwIfAborted();
      const bytes = Buffer.from(await image.blob.arrayBuffer());
      const extension = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      }[image.mime];
      const name = `minimax-tool-test.${extension}`;
      await writeFile(new URL(name, root), bytes);
      const item = {
        id: "live-image-1",
        name,
        type: image.mime,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        prompt: image.prompt,
        provider: image.provider,
      };
      attachments.push(item);
      return item;
    },
  });
  const report = {
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    requestedImage,
    output,
    attachments,
    redditContacted: false,
  };
  await writeFile(
    new URL("report.json", root),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      draftCreated: Boolean(output.draft),
      requestedImage,
      imagesAttached: attachments.length,
      elapsedSeconds: report.elapsedSeconds,
      report: ".local-tests/extension-live/report.json",
    }),
  );
  if (!output.draft || attachments.length !== 1) process.exitCode = 1;
} catch (error) {
  await writeFile(
    new URL("report.json", root),
    JSON.stringify(
      {
        error: error.message,
        requestedImage,
        attachments,
        redditContacted: false,
      },
      null,
      2,
    ) + "\n",
  );
  // Never dump provider response bodies, request headers, or credentials.
  console.error(
    error.name === "TimeoutError"
      ? "Live provider test timed out after 180 seconds."
      : error.message,
  );
  process.exitCode = 1;
}
