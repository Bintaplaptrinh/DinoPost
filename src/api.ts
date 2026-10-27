import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Bootstrap } from "./types";

export const desktop = isTauri();
export async function command<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop) {
    if (name === "bootstrap")
      return {
        drafts: [],
        messages: [],
        activity: [],
        chats: [],
        activeChatId: "preview",
        activeDraftId: null,
        browser: {
          status: "disconnected",
          username: null,
          message: "Connect Reddit once to get started.",
        },
        browserLinked: false,
        config: {
          nvidiaConfigured: false,
          typesafeConfigured: false,
          model: "minimaxai/minimax-m3.1-flash",
          browserModel: "jev-latest",
        },
      } as Bootstrap as T;
    throw new Error(
      "Open the DinoPost desktop app to use the agent and Chrome. Run npm run desktop.",
    );
  }
  return invoke<T>(name, args);
}
