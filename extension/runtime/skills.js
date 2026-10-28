export const SKILL_NAMES = Object.freeze([
  "brand-profile",
  "voice-builder",
  "writing-style-and-tone",
  "hook-writer",
  "text-post-and-microblog",
  "caption-writer",
  "reddit-marketing",
  "image-prompt",
]);

export async function loadSkills({
  fetchImpl = fetch,
  baseUrl = new URL("../skills/manifest.json", import.meta.url),
} = {}) {
  const manifestResponse = await fetchImpl(new URL("manifest.json", baseUrl));
  if (!manifestResponse.ok)
    throw new Error("Không thể đọc danh mục kỹ năng đã đóng gói.");
  const manifest = await manifestResponse.json();
  if (!manifest.files || !manifest.revision)
    throw new Error("Danh mục kỹ năng không hợp lệ.");
  const entries = await Promise.all(
    SKILL_NAMES.map(async (name) => {
      const relative = `${name}/SKILL.md`;
      const response = await fetchImpl(new URL(relative, baseUrl));
      if (!response.ok) throw new Error(`Thiếu kỹ năng: ${name}`);
      const text = await response.text();
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      );
      const sha256 = Array.from(new Uint8Array(bytes), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      if (sha256 !== manifest.files[relative])
        throw new Error(`Kỹ năng đã thay đổi: ${name}. Chạy lại bộ đồng bộ.`);
      return [name, text];
    }),
  );
  return {
    revision: manifest.revision,
    documents: Object.fromEntries(entries),
  };
}

export function skillContext(
  library,
  { image = false, hasMedia = false } = {},
) {
  const names = [
    "brand-profile",
    "voice-builder",
    "writing-style-and-tone",
    "hook-writer",
    "reddit-marketing",
    hasMedia ? "caption-writer" : "text-post-and-microblog",
  ];
  if (image) {
    if (!hasMedia) names.push("caption-writer");
    names.push("image-prompt");
  }
  return {
    names,
    text: names
      .map(
        (name) =>
          `\n<skill name="${name}">\n${library.documents[name]}\n</skill>`,
      )
      .join("\n"),
  };
}
