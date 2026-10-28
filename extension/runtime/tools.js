import { generatePollinationsImage, validateImagePrompt } from "./providers.js";

export const IMAGE_TOOL = Object.freeze({
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Generate ONE illustrative image only when the user explicitly requests an image. Returns an attachment receipt. Does not publish. Video is unavailable.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Specific natural-language visual brief: subject, composition, light, palette, style, constraints. Maximum 2000 characters.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
});

export function validateToolCall(call) {
  if (
    call?.type !== "function" ||
    call.function?.name !== "generate_image" ||
    typeof call.id !== "string" ||
    !call.id
  ) {
    throw new Error(
      "MiniMax yêu cầu công cụ không được hỗ trợ. Chỉ cho phép generate_image.",
    );
  }
  if (
    typeof call.function.arguments !== "string" ||
    call.function.arguments.length > 6000
  )
    throw new Error("Tham số công cụ không hợp lệ.");
  let args;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    throw new Error("Tham số công cụ phải là JSON hợp lệ.");
  }
  if (
    !args ||
    Array.isArray(args) ||
    Object.keys(args).length !== 1 ||
    !Object.hasOwn(args, "prompt")
  ) {
    throw new Error("Công cụ ảnh chỉ nhận một trường prompt.");
  }
  return { prompt: validateImagePrompt(args.prompt) };
}

export function createImageTools({
  generateImage = generatePollinationsImage,
  attachImage,
  signal,
}) {
  let called = false;
  return {
    definitions: [IMAGE_TOOL],
    async execute(call) {
      const args = validateToolCall(call);
      if (called) throw new Error("Mỗi lượt chỉ được tạo một ảnh.");
      called = true;
      signal?.throwIfAborted();
      const image = await generateImage({ ...args, signal });
      signal?.throwIfAborted();
      const receipt = await attachImage(image);
      // No image bytes, keys, provider URLs, selectors, or browser handles go back to the LLM.
      return {
        id: receipt.id,
        name: receipt.name,
        type: receipt.type,
        status: "attached",
        aiGenerated: true,
      };
    },
  };
}
