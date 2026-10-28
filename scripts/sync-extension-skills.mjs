import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Explicit refresh only: no runtime downloads, remote code, or unpinned updates.
const revision = "f28cef2b7067ec64e79c9d85421c022c06659e03";
const names = [
  "brand-profile",
  "voice-builder",
  "writing-style-and-tone",
  "hook-writer",
  "text-post-and-microblog",
  "caption-writer",
  "reddit-marketing",
  "image-prompt",
];
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const upstream = path.resolve(
  process.argv[2] || "../social-media-skills-upstream",
);
const actual = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (actual !== revision)
  throw new Error(`Expected upstream ${revision}, found ${actual}`);
const target = path.join(project, "extension", "skills");
await mkdir(target, { recursive: true });
const files = {};
for (const name of names) {
  const paths = execFileSync(
    "git",
    [
      "-C",
      upstream,
      "ls-tree",
      "-r",
      "--name-only",
      revision,
      "--",
      `skills/${name}/`,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const source of paths) {
    if (!source.startsWith(`skills/${name}/`) || source.includes(".."))
      throw new Error("Unexpected upstream path");
    const relative = source.slice("skills/".length);
    const destination = path.join(target, relative);
    // Read committed bytes, not a working copy modified by core.autocrlf or local edits.
    const bytes = execFileSync("git", [
      "-C",
      upstream,
      "show",
      `${revision}:${source}`,
    ]);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    files[relative] = createHash("sha256").update(bytes).digest("hex");
  }
}
await writeFile(
  path.join(target, "LICENSE"),
  execFileSync("git", ["-C", upstream, "show", `${revision}:LICENSE`]),
);
await writeFile(
  path.join(target, "manifest.json"),
  JSON.stringify(
    {
      repository: "https://github.com/social-media-skills/skills",
      revision,
      license: "MIT",
      skills: names,
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Vendored ${names.length} skills at ${revision}.`);
