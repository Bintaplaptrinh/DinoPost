import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("shows exact test caption, lets user edit, and makes desktop requirement explicit", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Today is the great day", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit draft" }).click();
  await page.getByRole("textbox", { name: "Post title" }).fill("A better day");
  await page
    .getByRole("textbox", { name: "Post body" })
    .fill("A moment worth sharing.");
  await page.getByRole("button", { name: "Done editing" }).click();
  await expect(
    page.getByRole("heading", { name: "A better day" }),
  ).toBeVisible();
  await expect(page.getByText("A moment worth sharing.")).toBeVisible();
  await page.getByRole("button", { name: /Confirm & publish/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Open the DinoPost desktop app",
  );
});

test("settings and activity are navigable without faking an account connection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("MiniMax M3.1 Flash", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Key needed", { exact: true })).toHaveCount(2);
  await page
    .getByRole("button", { name: /Connections/ })
    .first()
    .click();
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /Activity/ })
    .first()
    .click();
  await expect(
    page.getByText("Your saved drafts will appear here."),
  ).toBeVisible();
});

test("DOM reader traverses open shadow roots and excludes hidden controls", async ({
  page,
}) => {
  await page.route("https://www.reddit.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><h1>Fixture</h1><button role="combobox">r/test</button><div id="host"></div><button style="display:none">Hidden trap</button><button>Post</button><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML=\'<textarea aria-label="Title">Approved title</textarea>\';</script></body></html>',
    }),
  );
  await page.goto("https://www.reddit.com/r/test/submit");
  const source = readFileSync("src-tauri/src/snapshot.js", "utf8");
  const snapshot = await page.evaluate(source);
  expect(
    snapshot.controls.some(
      (c: { label: string; value: string }) =>
        c.label === "Title" && c.value === "Approved title",
    ),
  ).toBe(true);
  expect(
    snapshot.controls.some((c: { label: string }) => c.label === "Hidden trap"),
  ).toBe(false);
  expect(snapshot.blocked).toBe(false);
  expect(snapshot.destinations).toEqual(["r/test"]);
});

test("composer fits a desktop window", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Let’s make/ })).toBeVisible();
  await page.screenshot({
    path: "test-results/dinopost-desktop.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Reddit human verification is classified as a blocked page", async ({
  page,
}) => {
  await page.route("https://www.reddit.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Prove your humanity</h1><p>Complete the challenge below.</p>",
    }),
  );
  await page.goto("https://www.reddit.com/");
  expect(
    (await page.evaluate(readFileSync("src-tauri/src/snapshot.js", "utf8")))
      .blocked,
  ).toBe(true);
});

test("clicks the owning Reddit Post button for nested Lit spans in a shadow root", async ({
  page,
}) => {
  await page.route("https://www.reddit.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<button role="combobox">r/test</button><textarea aria-label="Title">Today is the great day</textarea><div id="host"></div><script>
      window.postClicks=0;
      document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<button disabled id="inner-post-submit-button" type="button" aria-label="Publish Reddit post"><span class="flex items-center gap-xs"><!--?lit$131237824$-->Post</span></button>';
      document.querySelector('#host').shadowRoot.querySelector('button').addEventListener('click',()=>window.postClicks++);
    </script>`,
    }),
  );
  await page.goto("https://www.reddit.com/r/test/submit");
  const source = readFileSync("src-tauri/src/snapshot.js", "utf8");
  let snapshot = await page.evaluate(source);
  expect(snapshot.postButtonDisabled).toBe(true);
  expect(
    snapshot.controls.filter((c: { postSubmit: boolean }) => c.postSubmit),
  ).toHaveLength(0);
  await page
    .locator("#inner-post-submit-button")
    .evaluate((el: HTMLButtonElement) => {
      el.disabled = false;
    });
  snapshot = await page.evaluate(source);
  const buttons = snapshot.controls.filter(
    (c: { postSubmit: boolean }) => c.postSubmit,
  );
  expect(buttons).toHaveLength(1);
  expect(buttons[0].tag).toBe("button");
  const guard = readFileSync("src-tauri/src/interact.js", "utf8")
    .trim()
    .replace(/;$/, "");
  const args = {
    ...buttons[0],
    token: snapshot.token,
    approved: {
      destination: "r/test",
      title: "Today is the great day",
      body: "",
    },
  };
  const point = await page.evaluate(`(${guard})(${JSON.stringify(args)})`);
  expect(point).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  await page.mouse.click(point.x, point.y);
  expect(await page.evaluate("window.postClicks")).toBe(1);
});

test("submit guard rejects changed content, changed destination, covered and stale controls", async ({
  page,
}) => {
  await page.route("https://www.reddit.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<button role="combobox" id="destination">r/test</button><textarea aria-label="Title">Approved title</textarea><textarea aria-label="Body">Approved body</textarea><button id="submit">Post</button>',
    }),
  );
  await page.goto("https://www.reddit.com/r/test/submit");
  const snapshot = await page.evaluate(
    readFileSync("src-tauri/src/snapshot.js", "utf8"),
  );
  const button = snapshot.controls.find(
    (c: { label: string }) => c.label === "Post",
  );
  const args = {
    ...button,
    token: snapshot.token,
    approved: {
      destination: "r/test",
      title: "Approved title",
      body: "Approved body",
    },
  };
  const guard = readFileSync("src-tauri/src/interact.js", "utf8");
  const evaluate = () =>
    page.evaluate(
      `(${guard.trim().replace(/;$/, "")})(${JSON.stringify(args)})`,
    );
  expect(await evaluate()).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number),
  });
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Unapproved change");
  expect(await evaluate()).toBeNull();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Approved title");
  await page.locator("#destination").evaluate((el) => {
    el.textContent = "r/other";
  });
  expect(await evaluate()).toBeNull();
  await page.locator("#destination").evaluate((el) => {
    el.textContent = "r/test";
  });
  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.id = "overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:white;z-index:999";
    document.body.append(overlay);
  });
  expect(await evaluate()).toBeNull();
  await page.locator("#overlay").evaluate((el) => el.remove());
  await page.evaluate(readFileSync("src-tauri/src/snapshot.js", "utf8"));
  expect(await evaluate()).toBeNull();
});
