export interface Draft {
  id: string;
  revision: number;
  destination: string;
  title: string;
  body: string;
  status:
    | "draft"
    | "running"
    | "waiting_login"
    | "blocked"
    | "submitting"
    | "uncertain"
    | "published";
  postUrl: string | null;
  updatedAt: string;
}
export interface Message {
  role: "user" | "assistant";
  content: string;
}
export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  draftId: string | null;
  messageCount: number;
}
export interface Activity {
  id: number;
  draftId: string | null;
  message: string;
  createdAt: string;
}
export interface ConfigStatus {
  nvidiaConfigured: boolean;
  typesafeConfigured: boolean;
  model: string;
  browserModel: string;
}
export interface BrowserStatus {
  status:
    "disconnected" | "connecting" | "connected" | "login_required" | "blocked";
  username: string | null;
  message: string;
}
export interface Bootstrap {
  drafts: Draft[];
  messages: Message[];
  activity: Activity[];
  config: ConfigStatus;
  chats: ChatSession[];
  activeChatId: string;
  activeDraftId: string | null;
  browser: BrowserStatus;
  browserLinked: boolean;
}
