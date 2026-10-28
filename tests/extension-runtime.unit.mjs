import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  runContentAgent,
  parseAgentReply,
} from "../extension/runtime/agent.js";
import { loadSkills } from "../extension/runtime/skills.js";
import {
  createImageTools,
  validateToolCall,
} from "../extension/runtime/tools.js";
import {
  generatePollinationsImage,
  requestMiniMax,
} from "../extension/runtime/providers.js";
import {
  isRedditUrl,
  normalizeDestination,
  submitUrl,
} from "../extension/runtime/reddit.js";

const call = {
  id: "image-1",
  type: "function",
  function: {
    name: "generate_image",
    arguments: JSON.stringify({
      prompt:
        "An original green dinosaur reading beside a warm lamp, square illustration, no text.",
    }),
  },
};
const library = await loadSkills({
  fetchImpl: async (url) => new Response(await readFile(url)),
});
const input = {
  prompt: "Write a small post with an illustration.",
  draft: { title: "Old title", body: "Old body", destination: "r/test" },
  apiKey: "test-secret",
  allowImage: true,
  library,
  attachImage: async () => ({
    id: "asset-1",
    name: "art.jpg",
    type: "image/jpeg",
  }),
};

test("eight pinned skills load; tampered content is rejected", async () => {
  assert.equal(Object.keys(library.documents).length, 8);
  assert.equal(library.revision, "f28cef2b7067ec64e79c9d85421c022c06659e03");
  await assert.rejects(
    loadSkills({
      fetchImpl: async (url) =>
        new Response(
          String(url).endsWith("manifest.json")
            ? await readFile(url)
            : "tampered",
        ),
    }),
    /thay đổi/,
  );
});

test("MiniMax selects the image tool and receives only an attachment receipt", async () => {
  const requests = [];
  const output = await runContentAgent({
    ...input,
    generateImage: async () => ({
      blob: new Blob(["fixture"], { type: "image/jpeg" }),
    }),
    request: async (params) => {
      requests.push(structuredClone(params.messages));
      if (requests.length === 1)
        return { role: "assistant", content: null, tool_calls: [call] };
      return {
        content: JSON.stringify({
          message: "Created a draft and attached an AI illustration.",
          draft: { title: "New title", body: "" },
        }),
      };
    },
  });
  assert.equal(output.draft.body, "");
  assert.equal(requests.length, 2);
  const receipt = requests[1].find((message) => message.role === "tool");
  assert.equal(receipt.tool_call_id, call.id);
  assert.equal(JSON.parse(receipt.content).status, "attached");
  assert.ok(!JSON.stringify(requests).includes("test-secret"));
  assert.ok(!receipt.content.includes("blob"));
});

test("ordinary chat does not modify a draft or enable image tools", async () => {
  const result = await runContentAgent({
    ...input,
    allowImage: false,
    request: async (params) => {
      assert.equal(params.tools, undefined);
      return {
        content: '{"message":"What would you like to write?","draft":null}',
      };
    },
  });
  assert.equal(result.draft, null);
});

test("tool dispatch rejects unapproved images, video, arbitrary fields, and multiple requests", async () => {
  assert.throws(
    () =>
      validateToolCall({
        ...call,
        function: { name: "publish", arguments: "{}" },
      }),
    /không được hỗ trợ/,
  );
  assert.throws(
    () =>
      validateToolCall({
        ...call,
        function: {
          name: "generate_image",
          arguments: '{"prompt":"cat","url":"https://evil.invalid"}',
        },
      }),
    /một trường/,
  );
  for (const [allowImage, calls] of [
    [false, [call]],
    [true, [call, call]],
    [
      true,
      [{ ...call, function: { name: "generate_video", arguments: "{}" } }],
    ],
  ]) {
    await assert.rejects(
      runContentAgent({
        ...input,
        allowImage,
        request: async () => ({ tool_calls: calls }),
        generateImage: async () => {
          throw new Error("must not run");
        },
      }),
    );
  }
});

test("one image execution per turn and cancellation are enforced by executor", async () => {
  let count = 0;
  const tools = createImageTools({
    generateImage: async () => {
      count++;
      return {};
    },
    attachImage: input.attachImage,
  });
  await tools.execute(call);
  await assert.rejects(tools.execute(call), /một ảnh/);
  assert.equal(count, 1);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    runContentAgent({
      ...input,
      signal: aborted.signal,
      request: async () => {
        throw new Error("must not run");
      },
    }),
    { name: "AbortError" },
  );
});

test("provider errors return tool errors without false image success or draft edits", async () => {
  let turn = 0;
  const result = await runContentAgent({
    ...input,
    generateImage: async () => {
      throw new Error("HTTP 402");
    },
    request: async (params) => {
      if (turn++ === 0)
        return { role: "assistant", content: null, tool_calls: [call] };
      assert.deepEqual(JSON.parse(params.messages.at(-1).content), {
        status: "error",
        message: "HTTP 402",
      });
      return {
        content:
          '{"message":"Image generation failed; your draft is unchanged.","draft":null}',
      };
    },
  });
  assert.equal(result.draft, null);
});

test("strict final answer validation preserves empty body and never parses reasoning", async () => {
  assert.deepEqual(
    parseAgentReply('{"message":"Done","draft":{"title":"Hello","body":""}}')
      .draft,
    { title: "Hello", body: "" },
  );
  for (const bad of [
    'noise {"message":"bad"}',
    '{"message":"x","draft":{"title":"","body":"a"}}',
    '{"message":"x","draft":{"title":"a\\nb","body":"a"}}',
  ])
    assert.throws(() => parseAgentReply(bad));
  await assert.rejects(
    requestMiniMax({
      apiKey: "x",
      messages: [],
      fetchImpl: async () =>
        Response.json({
          choices: [
            { message: { reasoning_content: '{"message":"not final"}' } },
          ],
        }),
    }),
    /hoàn chỉnh/,
  );
});

test("NVIDIA request sends native function definitions, role history, and bounded output", async () => {
  await requestMiniMax({
    apiKey: "x",
    messages: [{ role: "user", content: "Hello" }],
    tools: [call],
    fetchImpl: async (url, config) => {
      assert.equal(url, "https://integrate.api.nvidia.com/v1/chat/completions");
      const body = JSON.parse(config.body);
      assert.equal(body.model, "minimaxai/minimax-m3.1-flash");
      assert.equal(body.tools.length, 1);
      assert.equal(body.messages[0].role, "user");
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    },
  });
});

test("image provider rejects HTML, empty files, oversized bodies, and rate limits", async () => {
  for (const response of [
    new Response("<html>error</html>", {
      headers: { "content-type": "text/html" },
    }),
    new Response("", { headers: { "content-type": "image/jpeg" } }),
    new Response("x", {
      headers: { "content-type": "image/jpeg", "content-length": "99999999" },
    }),
    new Response("rate limit", { status: 402 }),
  ]) {
    await assert.rejects(
      generatePollinationsImage({
        prompt: "an original illustration",
        fetchImpl: async () => response,
      }),
    );
  }
  await generatePollinationsImage({
    prompt: "dinosaur in a library",
    fetchImpl: async (url, config) => {
      assert.equal(url.hostname, "image.pollinations.ai");
      assert.equal(url.searchParams.get("width"), "768");
      assert.equal(url.searchParams.get("nologo"), null);
      assert.equal(config.redirect, "error");
      return new Response("fixture", {
        headers: { "content-type": "image/jpeg" },
      });
    },
  });
});

test("destinations and Reddit origins reject lookalikes and arbitrary URLs", () => {
  assert.equal(normalizeDestination("r/test"), "r/test");
  assert.match(
    submitUrl("u/sample", true),
    /\/user\/sample\/submit\?type=IMAGE$/,
  );
  for (const value of [
    "https://reddit.com/r/test",
    "r/test/evil",
    "r/test?redirect=x",
    "//evil.invalid",
  ])
    assert.throws(() => normalizeDestination(value));
  for (const url of [
    "https://reddit.com.evil.invalid/r/test/submit",
    "https://evil.invalid/reddit.com/",
    "http://www.reddit.com/",
  ])
    assert.equal(isRedditUrl(url), false);
});
