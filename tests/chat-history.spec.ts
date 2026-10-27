import { test, expect } from "@playwright/test";

// Exercise the actual React UI against an in-memory desktop IPC contract.
// SQLite migration and conversation isolation are tested in the Rust suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = "2026-10-27T05:00:00Z";
    const draft = {
      id: "draft-1",
      revision: 1,
      destination: "r/test",
      title: "Saved happy caption",
      body: "",
      status: "draft",
      postUrl: null,
      updatedAt: now,
    };
    const chats = [
      {
        id: "first",
        title: "My saved idea",
        createdAt: now,
        updatedAt: now,
        draftId: "draft-1" as string | null,
        messageCount: 2,
      },
    ];
    const messages: Record<string, { role: string; content: string }[]> = {
      first: [
        { role: "user", content: "Write a happy caption." },
        { role: "assistant", content: "Your saved caption is ready." },
      ],
    };
    let active = "first";
    let browser = {
      status: "connected",
      username: "test-account",
      message: "Connected to Reddit.",
    };
    let sequence = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const snapshot = () =>
      structuredClone({
        drafts: [draft],
        messages: messages[active],
        activity: [],
        config: {
          nvidiaConfigured: true,
          typesafeConfigured: true,
          model: "minimaxai/minimax-m3.1-flash",
          browserModel: "jev-latest",
        },
        chats,
        activeChatId: active,
        activeDraftId: chats.find((c) => c.id === active)?.draftId ?? null,
        browser,
        browserLinked: true,
      });
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (event: unknown) => void) => {
          const id = ++sequence;
          callbacks.set(id, callback);
          return id;
        },
        invoke: async (name: string, args: Record<string, unknown> = {}) => {
          if (name === "plugin:event|listen") {
            const id = ++sequence;
            listeners.set(id, {
              event: String(args.event),
              handler: Number(args.handler),
            });
            return id;
          }
          if (name === "plugin:event|unlisten") {
            listeners.delete(Number(args.eventId));
            return;
          }
          if (name === "bootstrap") return snapshot();
          if (name === "new_chat") {
            active = "chat-" + ++sequence;
            messages[active] = [];
            chats.unshift({
              id: active,
              title: "New chat",
              createdAt: now,
              updatedAt: now,
              draftId: null,
              messageCount: 0,
            });
            return snapshot();
          }
          if (name === "switch_chat") {
            active = String(args.id || "first");
            return snapshot();
          }
          throw new Error("Unexpected desktop call: " + name);
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener: (_: string, id: number) => listeners.delete(id),
      },
      setTestBrowserStatus: (status: string) => {
        browser = {
          status,
          username:
            status === "connected"
              ? "test-account"
              : (null as unknown as string),
          message:
            status === "login_required"
              ? "Log in to Reddit in Chrome."
              : "Chrome is closed. It will reopen when you confirm a post.",
        };
        for (const listener of listeners.values())
          if (listener.event === "browser-status")
            callbacks.get(listener.handler)?.({
              event: "browser-status",
              id: 0,
              payload: browser,
            });
      },
    });
  });
});

test("new chat starts empty and history restores the original messages and draft", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Your saved caption is ready.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saved happy caption" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByText("Your saved caption is ready.")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "A little idea. A big conversation." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Chat history/ }).click();
  await expect(
    page.getByRole("heading", { name: /Pick up where you left off/ }),
  ).toBeVisible();
  await page
    .locator(".chat-history-row")
    .filter({ hasText: "My saved idea" })
    .click();
  await expect(page.getByText("Your saved caption is ready.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saved happy caption" }),
  ).toBeVisible();
});

test("connected browser state updates automatically without check-connection controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Connected as u/test-account")).toBeVisible();
  await expect(page.getByText("Running on your device")).toHaveCount(0);
  await expect(page.getByText("JEV publishes in Chrome")).toHaveCount(0);
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /check.*connection|connect reddit/i }),
  ).toHaveCount(0);
  await page.evaluate('window.setTestBrowserStatus("login_required")');
  await expect(page.getByText("Waiting for sign-in in Chrome…")).toBeVisible();
  await page.evaluate('window.setTestBrowserStatus("connected")');
  await expect(page.getByText("Connected as u/test-account")).toBeVisible();
  await page.evaluate('window.setTestBrowserStatus("disconnected")');
  await expect(
    page.getByText("Chrome will reopen when you confirm."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Connections/ })
    .first()
    .click();
  await expect(page.getByText(/Chrome opens with DinoPost/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /check connection|check again/i }),
  ).toHaveCount(0);
});
