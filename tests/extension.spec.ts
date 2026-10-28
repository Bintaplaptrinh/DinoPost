import { expect, test } from "@playwright/test";
import { prepareRedditDraft } from "../extension/runtime/reddit.js";

const payload = {
  title: "A calm afternoon",
  body: "A simple test draft.",
  destination: "r/test",
  media: [] as object[],
};
const fixture = `<button role="combobox">r/test</button><input name="title"><textarea aria-label="Body"></textarea><button id="post" onclick="window.postClicks=(window.postClicks||0)+1">Post</button>`;
async function setup(
  page,
  html = fixture,
  url = "https://www.reddit.com/r/test/submit",
) {
  await page.route("https://www.reddit.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`,
    }),
  );
  await page.goto(url);
}

test("prepares exact content but leaves Post entirely manual", async ({
  page,
}) => {
  await setup(page);
  expect((await page.evaluate(prepareRedditDraft, payload)).state).toBe(
    "prepared",
  );
  await expect(page.locator("input[name=title]")).toHaveValue(payload.title);
  await expect(page.locator("textarea")).toHaveValue(payload.body);
  expect(await page.evaluate(() => (window as any).postClicks || 0)).toBe(0);
  expect(
    (await page.evaluate(prepareRedditDraft, { ...payload, body: "" })).state,
  ).toBe("prepared");
  await expect(page.locator("textarea")).toHaveValue("");
});

test("does not touch form fields during CAPTCHA or login", async ({ page }) => {
  for (const [barrier, state] of [
    ["<h1>Prove your humanity</h1>", "waiting_verification"],
    ['<input type="password">', "waiting_login"],
  ]) {
    await setup(page, barrier + fixture);
    expect((await page.evaluate(prepareRedditDraft, payload)).state).toBe(
      state,
    );
    await expect(page.locator("input[name=title]")).toHaveValue("");
    await page.unrouteAll();
  }
});

test("wrong URL or visible destination blocks before editing", async ({
  page,
}) => {
  await setup(page, fixture, "https://www.reddit.com/r/wrong/submit");
  expect((await page.evaluate(prepareRedditDraft, payload)).state).toBe(
    "blocked",
  );
  await page.unrouteAll();
  await setup(page, fixture.replace(">r/test<", ">r/other<"));
  expect((await page.evaluate(prepareRedditDraft, payload)).state).toBe(
    "blocked",
  );
  await expect(page.locator("input[name=title]")).toHaveValue("");
});

test("traverses shadow DOM and excludes search inputs", async ({ page }) => {
  await setup(
    page,
    `<nav><input name="title"></nav><div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(fixture)};</script>`,
  );
  expect((await page.evaluate(prepareRedditDraft, payload)).state).toBe(
    "prepared",
  );
  await expect(page.locator("nav input")).toHaveValue("");
  await expect(page.locator("#host input")).toHaveValue(payload.title);
});

test("attaches one decoded image once; never presses Post", async ({
  page,
}) => {
  await setup(page, fixture + '<input type="file" accept="image/*">');
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    return canvas.toDataURL("image/png");
  });
  const withImage = {
    ...payload,
    body: "First paragraph.\n\nSecond paragraph.",
    media: [{ name: "test.png", type: "image/png", base64 }],
  };
  expect(await page.evaluate(prepareRedditDraft, withImage)).toMatchObject({
    state: "prepared",
  });
  expect(
    await page
      .locator("input[type=file]")
      .evaluate((el: HTMLInputElement) => el.files?.length),
  ).toBe(1);
  expect((await page.evaluate(prepareRedditDraft, withImage)).state).toBe(
    "blocked",
  );
  expect(await page.evaluate(() => (window as any).postClicks || 0)).toBe(0);
});

test("ambiguous upload controls and corrupt image stop without upload", async ({
  page,
}) => {
  await setup(
    page,
    fixture +
      '<input type="file" accept="image/*"><input type="file" accept="image/*">',
  );
  const media = [
    {
      name: "broken.jpg",
      type: "image/jpeg",
      base64: "data:image/jpeg;base64,YmFk",
    },
  ];
  expect(
    (await page.evaluate(prepareRedditDraft, { ...payload, media })).state,
  ).toBe("blocked");
  await page
    .locator("input[type=file]")
    .last()
    .evaluate((el) => el.remove());
  expect(
    (await page.evaluate(prepareRedditDraft, { ...payload, media })).state,
  ).toBe("blocked");
  expect(
    await page
      .locator("input[type=file]")
      .evaluate((el: HTMLInputElement) => el.files?.length),
  ).toBe(0);
});

test("current inline editor accepts exactly one image paste and rejects a repeated attachment", async ({
  page,
}) => {
  await setup(
    page,
    `<button>r/test</button><input name="title"><div contenteditable="true" data-lexical-editor aria-label="Body" style="min-height:100px"></div><button aria-label="Hình ảnh">Image</button><input hidden type="file" accept="image/*"><input hidden type="file" accept="image/*"><button id="post" onclick="window.postClicks=(window.postClicks||0)+1">Post</button>
  <script>document.querySelector('[contenteditable]').addEventListener('paste', event => { event.preventDefault(); if (!event.clipboardData.files.length) { document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); return; } window.pasteCalls=(window.pasteCalls||0)+1; const image=document.createElement('img'); image.src=URL.createObjectURL(event.clipboardData.files[0]); image.style.width='32px'; document.querySelector('[contenteditable]').append(image); });</script>`,
  );
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    return canvas.toDataURL("image/png");
  });
  const withImage = {
    ...payload,
    media: [{ name: "test.png", type: "image/png", base64 }],
  };
  withImage.body = "First paragraph.\n\nSecond paragraph.";
  const inlineResult = await page.evaluate(prepareRedditDraft, withImage);
  expect(inlineResult.state, inlineResult.message).toBe("prepared");
  await expect(page.locator("[contenteditable] img")).toBeVisible();
  expect((await page.evaluate(prepareRedditDraft, withImage)).state).toBe(
    "blocked",
  );
  expect(await page.evaluate(() => (window as any).pasteCalls)).toBe(1);
  expect(await page.evaluate(() => (window as any).postClicks || 0)).toBe(0);
});

test("side panel chats, dispatches one image tool, persists, and renders at side-panel width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.addInitScript(() => {
    const noop = { addListener() {} };
    (window as any).chrome = {
      storage: {
        local: {
          async get(keys: string[]) {
            const saved = JSON.parse(
              localStorage.getItem("extensionFixture") ||
                '{"nvidiaApiKey":"fixture-key"}',
            );
            return Object.fromEntries(keys.map((key) => [key, saved[key]]));
          },
          async set(values: object) {
            localStorage.setItem(
              "extensionFixture",
              JSON.stringify({
                ...JSON.parse(
                  localStorage.getItem("extensionFixture") ||
                    '{"nvidiaApiKey":"fixture-key"}',
                ),
                ...values,
              }),
            );
          },
        },
      },
      tabs: {
        query: async () => [
          { id: 1, url: "https://www.reddit.com/r/test/submit/" },
        ],
        update: async () => {
          (window as any).fixtureNavigated = true;
        },
        onActivated: noop,
        onUpdated: noop,
      },
      scripting: {
        executeScript: async ({ args }: any) => {
          (window as any).fixturePreparePayload = args[0];
          return [
            {
              result: {
                state: "prepared",
                message: "Prepared fixture without publishing.",
              },
            },
          ];
        },
      },
    };
  });
  let requests = 0;
  await page.route("https://integrate.api.nvidia.com/**", (route) => {
    requests++;
    const message =
      requests === 1
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "image-test",
                type: "function",
                function: {
                  name: "generate_image",
                  arguments:
                    '{"prompt":"An original green dinosaur reading in a quiet library, square illustration, no text."}',
                },
              },
            ],
          }
        : {
            role: "assistant",
            content:
              '{"message":"Here is a draft and an AI illustration.","draft":{"title":"A calm afternoon","body":"A test illustration."}}',
          };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message }] }),
    });
  });
  // Real image decoding; only the network transport is mocked.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(0, 0, 16, 16);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.route("https://image.pollinations.ai/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(png, "base64"),
    }),
  );
  await page.goto("/extension/popup/popup.html");
  await expect(page.locator("#statusText")).toContainText("Chrome");
  await page
    .locator("#promptInput")
    .fill("Write a test post and create one dinosaur illustration.");
  await page.locator("#btnGenerate").click();
  await expect(page.locator("#btnGenerate")).toBeEnabled({ timeout: 15000 });
  expect(await page.locator("#aiStatusMessage").textContent()).toContain(
    "AI illustration",
  );
  await expect(page.locator("#postTitle")).toHaveValue("A calm afternoon");
  await expect(page.locator("#mediaPreviewList img")).toBeVisible();
  await page.locator("#btnPublish").click();
  await expect(page.locator("#resultMessage")).toContainText(
    "Prepared fixture",
  );
  expect(
    await page.evaluate(() => Boolean((window as any).fixtureNavigated)),
  ).toBe(false);
  expect(
    await page.evaluate(() => (window as any).fixturePreparePayload.title),
  ).toBe("A calm afternoon");
  await expect(page.locator("#chatHistory")).toContainText("AI illustration");
  expect(requests).toBe(2);
  await page.reload();
  await expect(page.locator("#postTitle")).toHaveValue("A calm afternoon");
  await expect(page.locator("#mediaPreviewList img")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/extension-side-panel.png",
    fullPage: true,
  });
});
