export const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";
export const MINIMAX_MODEL = "minimaxai/minimax-m3.1-flash";
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function requestMiniMax({
  apiKey,
  messages,
  tools,
  signal,
  fetchImpl = fetch,
}) {
  if (!apiKey?.trim())
    throw new Error("Hãy lưu NVIDIA API Key trong Cài đặt trước.");
  const response = await fetchImpl(NVIDIA_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages,
      tools,
      stream: false,
      max_tokens: 4096,
      temperature: 1,
      top_p: 0.95,
      chat_template_kwargs: { reasoning_effort: "low" },
    }),
  });
  if (!response.ok)
    throw new Error(
      `MiniMax HTTP ${response.status}. Kiểm tra key hoặc hạn mức và thử lại.`,
    );
  const payload = await response.json();
  if (payload.choices?.[0]?.finish_reason === "length")
    throw new Error("MiniMax trả lời chưa hoàn tất. Hãy rút ngắn yêu cầu.");
  const message = payload.choices?.[0]?.message;
  if (
    !message ||
    (typeof message.content !== "string" && !message.tool_calls?.length)
  ) {
    throw new Error("MiniMax không trả về câu trả lời hoàn chỉnh.");
  }
  // Never treat reasoning_content as a final answer or executable tool request.
  return message;
}

export function validateImagePrompt(prompt) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 2000) {
    throw new Error("Mô tả ảnh phải có từ 1 đến 2000 ký tự.");
  }
  return prompt.trim();
}

export async function generatePollinationsImage({
  prompt,
  signal,
  fetchImpl = fetch,
}) {
  prompt = validateImagePrompt(prompt);
  // Classic API: one model, <=768x768 area, visible provider logo. Best effort, rate limited.
  const url = new URL(
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`,
  );
  url.search = new URLSearchParams({
    width: "768",
    height: "768",
    seed: String(Math.floor(Math.random() * 1e9)),
    safe: "true",
  });
  const response = await fetchImpl(url, {
    signal,
    redirect: "error",
    headers: { Accept: "image/jpeg" },
  });
  if (!response.ok) {
    if ([402, 429].includes(response.status)) {
      throw new Error(
        "Dịch vụ ảnh đang giới hạn lượt miễn phí. Chờ ít nhất 45 giây hoặc tải ảnh từ máy.",
      );
    }
    throw new Error(
      `Dịch vụ ảnh HTTP ${response.status}. Bạn có thể tải ảnh từ máy để tiếp tục.`,
    );
  }
  const mime = (response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime))
    throw new Error("Dịch vụ ảnh trả về dữ liệu không phải ảnh.");
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES)
    throw new Error("Ảnh vượt giới hạn 4 MiB.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("Ảnh vượt giới hạn 4 MiB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (!size) throw new Error("Dịch vụ ảnh trả về tệp rỗng.");
  return {
    blob: new Blob(chunks, { type: mime }),
    mime,
    prompt,
    provider: "pollinations-classic",
  };
}
