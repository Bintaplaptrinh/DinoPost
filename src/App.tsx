import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
  CircleCheck,
  Clock3,
  Ellipsis,
  ExternalLink,
  Feather,
  Globe2,
  History,
  Info,
  Layers3,
  Link2,
  LoaderCircle,
  MessageSquare,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { command, desktop } from "./api";
import type {
  Activity,
  Bootstrap,
  BrowserStatus,
  ConfigStatus,
  Draft,
  Message,
  ChatSession,
} from "./types";

type View = "compose" | "chats" | "activity" | "connections" | "settings";
const testCaption = "Today is the great day";
const blankBrowser: BrowserStatus = {
  status: "disconnected",
  username: null,
  message: "Connect your Reddit account in Chrome to get started.",
};
const initialConfig: ConfigStatus = {
  nvidiaConfigured: false,
  typesafeConfigured: false,
  model: "minimaxai/minimax-m3.1-flash",
  browserModel: "jev-latest",
};
const editableStatuses = ["draft", "waiting_login", "blocked"];

function Dino({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "dino small" : "dino"}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M13 10h6V6h14v16H23v6h-5v7h-5v-9H9v-5H5v-8h4v5h4V10Z"
        fill="currentColor"
      />
      <path d="M26 10h3v3h-3z" fill="var(--dino-eye, #202820)" />
      <path d="M24 19h10v3H24zM21 25h7v3h-7z" fill="currentColor" />
    </svg>
  );
}
function RedditIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="Reddit"
    >
      <circle cx="16" cy="16" r="16" fill="#FF4500" />
      <path
        d="M24 16a3 3 0 0 0-4.7-2.5 14 14 0 0 0-3-.5l1-4.5 3.2.7a2 2 0 1 0 .4-1.4l-4.3-1-1.3 6.2a14 14 0 0 0-3.6.6A3 3 0 0 0 7 16c0 .8.3 1.4.8 2-.1.3-.1.6-.1 1 0 3.3 3.8 6 8.3 6s8.3-2.7 8.3-6c0-.4 0-.7-.1-1 .5-.6.8-1.2.8-2Z"
        fill="white"
      />
      <circle cx="12.5" cy="18" r="1.5" fill="#FF4500" />
      <circle cx="19.5" cy="18" r="1.5" fill="#FF4500" />
      <path
        d="M12 21c2 1.5 6 1.5 8 0"
        stroke="#FF4500"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function formatTime(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export default function App() {
  const [view, setView] = useState<View>("compose");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [config, setConfig] = useState(initialConfig);
  const [browser, setBrowser] = useState(blankBrowser);
  const [browserLinked, setBrowserLinked] = useState(false);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [destination, setDestination] = useState("r/test");
  const [title, setTitle] = useState(testCaption);
  const [body, setBody] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nvidiaKey, setNvidiaKey] = useState("");
  const [typesafeKey, setTypesafeKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const canEdit = !busy && (!draft || editableStatuses.includes(draft.status));
  const changed =
    !draft ||
    draft.title !== title ||
    draft.body !== body ||
    draft.destination !== destination;
  const terminal =
    draft &&
    ["published", "uncertain", "submitting", "running"].includes(draft.status);
  const published = drafts.filter((d) => d.status === "published").length;

  function selectDraft(d: Draft | null) {
    setDraft(d);
    setTitle(d?.title ?? testCaption);
    setBody(d?.body ?? "");
    setDestination(d?.destination ?? "r/test");
    setEditing(false);
    setError("");
  }
  function applyData(data: Bootstrap, restoreDraft = true) {
    setDrafts(data.drafts);
    setMessages(data.messages);
    setActivity(data.activity);
    setConfig(data.config);
    setChats(data.chats);
    setActiveChatId(data.activeChatId);
    setBrowser(data.browser);
    setBrowserLinked(data.browserLinked);
    if (restoreDraft)
      selectDraft(data.drafts.find((d) => d.id === data.activeDraftId) ?? null);
  }
  async function refresh() {
    const data = await command<Bootstrap>("bootstrap");
    applyData(data, false);
    return data;
  }
  useEffect(() => {
    let active = true;
    command<Bootstrap>("bootstrap")
      .then((data) => {
        if (!active) return;
        applyData(data);
        setReady(true);
      })
      .catch((e) => {
        if (active) {
          setError(String(e));
          setReady(true);
        }
      });
    let stop: (() => void) | undefined;
    if (desktop)
      listen<string>("activity-updated", () => {
        command<Bootstrap>("bootstrap")
          .then((data) => {
            if (active) {
              setActivity(data.activity);
              setDrafts(data.drafts);
              setChats(data.chats);
            }
          })
          .catch(() => {});
      }).then((fn) => {
        if (active) stop = fn;
        else fn();
      });
    let stopBrowser: (() => void) | undefined;
    if (desktop)
      listen<BrowserStatus>("browser-status", (event) => {
        if (!active) return;
        setBrowser(event.payload);
        if (
          ["connected", "login_required", "blocked"].includes(
            event.payload.status,
          )
        )
          setBrowserLinked(true);
      }).then((fn) => {
        if (active) stopBrowser = fn;
        else fn();
      });
    return () => {
      active = false;
      stop?.();
      stopBrowser?.();
    };
  }, []);
  useEffect(() => {
    const scroller = chatEnd.current?.parentElement;
    if (scroller)
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  async function task(name: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function save(): Promise<Draft> {
    const result = await command<Draft>("save_draft", {
      id: draft?.id ?? null,
      revision: draft?.revision ?? null,
      destination: destination.trim(),
      title,
      body,
      chatId: activeChatId,
    });
    selectDraft(result);
    await refresh();
    return result;
  }
  async function send(text = input) {
    if (!text.trim() || busy || !ready) return;
    await task("thinking", async () => {
      const current = changed && canEdit ? await save() : draft;
      const reply = await command<{ message: Message; draft: Draft }>("chat", {
        content: text.trim(),
        destination: destination.trim(),
        draftId: current?.id ?? null,
        chatId: activeChatId,
      });
      setInput("");
      selectDraft(reply.draft);
      await refresh();
    });
  }
  async function connect() {
    await task("connecting", async () => {
      const result = await command<BrowserStatus>("connect_reddit");
      setBrowser(result);
      setNotice(result.message);
      await refresh();
    });
  }
  async function confirm() {
    await task("publishing", async () => {
      const approved = changed ? await save() : draft!;
      try {
        const result = await command<{
          draft: Draft;
          browser: BrowserStatus;
          message: string;
        }>("approve_and_post", {
          id: approved.id,
          revision: approved.revision,
        });
        selectDraft(result.draft);
        setBrowser(result.browser);
        setNotice(result.message);
      } finally {
        const data = await refresh();
        const latest = data.drafts.find((d) => d.id === approved.id);
        if (latest) selectDraft(latest);
      }
    });
  }
  async function saveKeys() {
    await task("settings", async () => {
      const result = await command<ConfigStatus>("save_settings", {
        nvidia: nvidiaKey || null,
        typesafe: typesafeKey || null,
      });
      setConfig(result);
      setNvidiaKey("");
      setTypesafeKey("");
      setNotice("API keys saved in Windows Credential Manager.");
    });
  }
  async function newDraft() {
    if (busy) return;
    await task("loading", async () => {
      if (
        changed &&
        canEdit &&
        title.trim() &&
        (draft || title !== testCaption || body || destination !== "r/test")
      )
        await save();
      applyData(await command<Bootstrap>("new_chat"));
      setInput("");
      setView("compose");
    });
  }
  async function switchChat(id: string | null, draftId: string | null = null) {
    if (busy) return;
    await task("loading", async () => {
      if (
        changed &&
        canEdit &&
        title.trim() &&
        (draft || title !== testCaption || body || destination !== "r/test")
      )
        await save();
      applyData(await command<Bootstrap>("switch_chat", { id, draftId }));
      setInput("");
      setView("compose");
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => setView("compose")}
          aria-label="DinoPost home"
        >
          <span className="brand-mark">
            <Dino />
          </span>
          <span>
            DinoPost<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="workspace">
          <span className="workspace-avatar">
            P<span />
          </span>
          <div>
            <strong>Personal workspace</strong>
            <span>Make your mark</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          <button
            className={view === "compose" ? "nav-item active" : "nav-item"}
            onClick={() => setView("compose")}
          >
            <SquarePen size={18} /> Create a post{" "}
            <span className="nav-shortcut">N</span>
          </button>
          <button
            className={view === "activity" ? "nav-item active" : "nav-item"}
            onClick={() => setView("activity")}
          >
            <History size={18} /> Activity{" "}
            <span className="nav-count">{drafts.length}</span>
          </button>
          <button
            className={view === "connections" ? "nav-item active" : "nav-item"}
            onClick={() => setView("connections")}
          >
            <Link2 size={18} /> Connections <span className="connection-dot" />
          </button>
        </nav>
        <button
          className={view === "chats" ? "nav-item active" : "nav-item"}
          onClick={() => setView("chats")}
        >
          <MessageSquare size={18} /> Chat history{" "}
          <span className="nav-count">{chats.length}</span>
        </button>
        {chats.length > 0 && (
          <div className="recent-chats">
            <div className="nav-caption">RECENT CHATS</div>
            <div className="recent-chat-list">
              {chats.slice(0, 5).map((chat) => (
                <button
                  key={chat.id}
                  className={
                    chat.id === activeChatId
                      ? "recent-chat selected"
                      : "recent-chat"
                  }
                  disabled={!!busy}
                  onClick={() => void switchChat(chat.id)}
                  title={chat.title}
                >
                  <MessageSquare size={13} />
                  <span>{chat.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="sidebar-section">
          <div className="nav-caption">YOUR CHANNELS</div>
          <button
            className="channel-item"
            onClick={() => setView("connections")}
          >
            <RedditIcon />
            <span>Reddit</span>
            <span
              className={`tiny-status ${browser.status === "connected" ? "online" : ""}`}
            />
          </button>
          <span className="coming-next">
            <Globe2 size={15} /> More platforms, coming soon
          </span>
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon">
              <ShieldCheck size={19} />
            </span>
            <strong>Your device. Your control.</strong>
            <p>
              Runs locally. Publishes only
              <br />
              with your approval.
            </p>
            <span>
              <span className="connection-dot" /> Local-first by design
            </span>
          </div>
          <button
            className={view === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => setView("settings")}
          >
            <Settings2 size={18} /> Settings
          </button>
          <div className="sidebar-footer">
            <span className="mini-mark">
              <Dino small />
            </span>
            <span>DinoPost v0.1.0</span>
            <span className="alpha-label">ALPHA</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <span>/</span>{" "}
            <strong>
              {
                {
                  compose: "Create a post",
                  activity: "Activity",
                  connections: "Connections",
                  settings: "Settings",
                  chats: "Chat history",
                }[view]
              }
            </strong>
          </div>
          <div className="topbar-right">
            {!desktop && (
              <span className="local-badge">Desktop UI preview</span>
            )}
            <span className="user-avatar">You</span>
          </div>
        </header>
        <div className="page-body">
          {error && (
            <div role="alert" className="banner error">
              <Info size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="banner notice">
              <CircleCheck size={18} />
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "compose" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span /> SMALL IDEAS. BIG FOOTPRINTS.
                  </div>
                  <h1>
                    Let’s make something worth sharing<span>.</span>
                  </h1>
                  <p>
                    Bring the idea. Dino will help with the words and the
                    legwork.
                  </p>
                </div>
                <button
                  className="button secondary new-draft"
                  onClick={newDraft}
                  disabled={!!busy}
                >
                  <Plus size={16} /> New chat
                </button>
              </div>
              <div className="compose-grid">
                <section className="chat-panel panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <span className="assistant-avatar">
                        <Dino small />
                      </span>
                      <div>
                        <strong>Your creative sidekick</strong>
                        <span>
                          <span className="connection-dot" /> Dino · powered by
                          MiniMax
                        </span>
                      </div>
                    </div>
                    <span className="label-muted">CONTENT STUDIO</span>
                  </div>
                  <div
                    className={`chat-content ${messages.length ? "has-messages" : ""}`}
                  >
                    {!messages.length && (
                      <div className="welcome">
                        <span className="welcome-icon">
                          <Feather size={28} strokeWidth={1.5} />
                          <Sparkles size={15} />
                        </span>
                        <h2>
                          A little idea.
                          <br />A big conversation.
                        </h2>
                        <p>
                          Tell me what’s on your mind. We’ll turn it into
                          <br />a post that sounds like you.
                        </p>
                        <div className="prompt-options">
                          <button
                            disabled={!!busy}
                            onClick={() =>
                              send(
                                "Help me write a short, optimistic Reddit post about enjoying the little things today.",
                              )
                            }
                          >
                            <span>
                              <Sparkles size={16} /> Make an idea into a post
                            </span>
                            <ArrowUpRight size={15} />
                          </button>
                          <button
                            disabled={!!busy}
                            onClick={() => {
                              setTitle(testCaption);
                              setBody("");
                              setDraft(null);
                              setNotice(
                                "Test caption loaded. Review the destination, then confirm when you are ready.",
                              );
                            }}
                          >
                            <span>
                              <Terminal size={16} /> Try “{testCaption}”
                            </span>
                            <ArrowUpRight size={15} />
                          </button>
                        </div>
                        <div className="welcome-note">
                          <ShieldCheck size={14} /> Nothing goes live until you
                          say so.
                        </div>
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div key={i} className={`message ${m.role}`}>
                        <span
                          className={
                            m.role === "assistant"
                              ? "message-avatar assistant-avatar"
                              : "message-avatar user-avatar"
                          }
                        >
                          {m.role === "assistant" ? <Dino small /> : "Y"}
                        </span>
                        <div>
                          <div className="message-name">
                            {m.role === "assistant" ? "Dino" : "You"}
                            {m.role === "assistant" && (
                              <span>CONTENT PARTNER</span>
                            )}
                          </div>
                          <p>{m.content}</p>
                        </div>
                      </div>
                    ))}
                    {busy === "thinking" && (
                      <div className="message assistant">
                        <span className="message-avatar assistant-avatar">
                          <Dino small />
                        </span>
                        <div className="thinking">
                          <span />
                          <span />
                          <span /> Thinking of the right words…
                        </div>
                      </div>
                    )}
                    <div ref={chatEnd} />
                  </div>
                  <form
                    className="chat-input-wrap"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                  >
                    <div className="chat-input">
                      <textarea
                        aria-label="Message Dino"
                        placeholder="What would you like to share today?"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={!!busy}
                        maxLength={6000}
                        rows={2}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                      />
                      <div className="input-bottom">
                        <span>
                          <Sparkles size={13} /> MiniMax M3.1 Flash
                        </span>
                        <button
                          type="submit"
                          className="send-button"
                          aria-label="Send message"
                          disabled={!!busy || !input.trim()}
                        >
                          {busy === "thinking" ? (
                            <LoaderCircle className="spin" size={17} />
                          ) : (
                            <ArrowUp size={18} />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="input-hint">
                      <span>
                        <kbd>Enter</kbd> to send <span>·</span>{" "}
                        <kbd>Shift + Enter</kbd> for a new line
                      </span>
                      <span>
                        {input.length > 5500
                          ? `${input.length}/6000`
                          : "Made for your voice"}
                      </span>
                    </div>
                  </form>
                </section>
                <div className="right-column">
                  <section className="preview-panel panel">
                    <div className="panel-header">
                      <div className="section-title">
                        <Layers3 size={17} />
                        <strong>Post preview</strong>
                      </div>
                      <span
                        className={`status-pill ${draft?.status === "published" ? "success" : ""}`}
                      >
                        <span />
                        {draft?.status === "published"
                          ? "Published"
                          : draft?.status === "waiting_login"
                            ? "Login needed"
                            : draft?.status === "uncertain"
                              ? "Check Chrome"
                              : "Draft"}
                      </span>
                    </div>
                    <div className="preview-inner">
                      <div className="destination-label">PUBLISH TO</div>
                      <label className="destination-input">
                        <RedditIcon />
                        <input
                          aria-label="Reddit destination"
                          value={destination}
                          onChange={(e) => setDestination(e.target.value)}
                          disabled={!canEdit}
                          placeholder="r/community or u/username"
                          spellCheck={false}
                        />
                        <span>REDDIT</span>
                      </label>
                      <div className="post-card">
                        <div className="post-author">
                          <span className="reddit-community">
                            <RedditIcon />
                          </span>
                          <div>
                            <strong>
                              {destination || "Choose a community"}
                            </strong>
                            <span>
                              u/{browser.username ?? "your-account"}{" "}
                              <span>·</span> just now
                            </span>
                          </div>
                          <Ellipsis size={20} />
                        </div>
                        {editing ? (
                          <div className="draft-editor">
                            <label>
                              Title
                              <textarea
                                aria-label="Post title"
                                value={title}
                                disabled={!canEdit}
                                onChange={(e) => setTitle(e.target.value)}
                                maxLength={300}
                                rows={3}
                              />
                            </label>
                            <label>
                              Body <span>(optional)</span>
                              <textarea
                                aria-label="Post body"
                                value={body}
                                disabled={!canEdit}
                                onChange={(e) => setBody(e.target.value)}
                                maxLength={40000}
                                rows={4}
                              />
                            </label>
                          </div>
                        ) : (
                          <>
                            <h3>{title || "Your post title goes here"}</h3>
                            {body && <p className="post-body">{body}</p>}
                          </>
                        )}
                        <div className="post-actions">
                          <span className="vote-pill">
                            <ArrowUp size={15} /> <span>Vote</span>
                            <ArrowDown size={15} />
                          </span>
                          <span>
                            <MessageSquare size={14} /> 0
                          </span>
                          <span>
                            <ArrowUpRight size={15} /> Share
                          </span>
                        </div>
                      </div>
                      <div className="preview-meta">
                        <span>
                          <span className="connection-dot" /> Text post{" "}
                          <span className="meta-dot">·</span> {title.length}/300
                          characters
                        </span>
                        <button
                          className="text-button"
                          onClick={() => setEditing(!editing)}
                          disabled={!canEdit}
                        >
                          {editing ? (
                            <>
                              <Check size={13} /> Done editing
                            </>
                          ) : (
                            <>
                              <SquarePen size={13} /> Edit draft
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="approval-area">
                      <div className="approval-heading">
                        <ShieldCheck size={17} />
                        <strong>You have the final say.</strong>
                      </div>
                      <p>
                        Review the content and destination. Dino will open
                        Chrome and publish this exact post.
                      </p>
                      {draft?.status === "published" && draft.postUrl ? (
                        <div className="published-link">
                          <CircleCheck size={18} />
                          <span>Published to {draft.destination}</span>
                          <code>{draft.postUrl}</code>
                        </div>
                      ) : (
                        <button
                          className="button primary confirm-button"
                          disabled={
                            !!busy ||
                            !ready ||
                            !title.trim() ||
                            !!terminal ||
                            !destination.trim()
                          }
                          onClick={() => void confirm()}
                        >
                          {busy === "publishing" ? (
                            <>
                              <LoaderCircle size={17} className="spin" /> Dino
                              is on it…
                            </>
                          ) : draft?.status === "waiting_login" ? (
                            <>
                              <CheckCheck size={17} /> I’ve logged in · continue
                            </>
                          ) : draft?.status === "uncertain" ? (
                            <>
                              <Info size={17} /> Check the result in Chrome
                            </>
                          ) : (
                            <>
                              <CheckCheck size={17} /> Confirm & publish{" "}
                              <ArrowRight size={16} />
                            </>
                          )}
                        </button>
                      )}
                      <span className="approval-footnote">
                        {changed
                          ? "Your edits will be saved before approval."
                          : `Revision ${draft?.revision ?? 1} · approval required for every post`}
                      </span>
                    </div>
                  </section>
                  <section className="browser-panel panel">
                    <div className="browser-heading">
                      <span className="chrome-icon">
                        <Globe2 size={18} />
                      </span>
                      <div>
                        <strong>Your browser, the driver</strong>
                        <span>Installed Chrome · DOM-first</span>
                      </div>
                      <span className="jev-badge">
                        <Zap size={11} fill="currentColor" /> JEV
                      </span>
                    </div>
                    <div className="workflow">
                      <div className="workflow-line" />
                      <div className="workflow-step">
                        <span className="step-dot done">
                          <Check size={11} />
                        </span>
                        <span>You review & approve</span>
                        <span>01</span>
                      </div>
                      <div className="workflow-step">
                        <span
                          className={`step-dot ${browser.status === "connected" ? "done" : ""}`}
                        >
                          {browser.status === "connected" ? (
                            <Check size={11} />
                          ) : (
                            <Circle size={7} />
                          )}
                        </span>
                        <span>Dino checks your Reddit login</span>
                        <span>02</span>
                      </div>
                      <div className="workflow-step">
                        <span
                          className={`step-dot ${draft?.status === "published" ? "done" : ""}`}
                        >
                          {draft?.status === "published" ? (
                            <Check size={11} />
                          ) : (
                            <Circle size={7} />
                          )}
                        </span>
                        <span>Published</span>
                        <span>03</span>
                      </div>
                    </div>
                    {(browser.status === "blocked" ||
                      browser.status === "login_required") && (
                      <p className="browser-attention">{browser.message}</p>
                    )}
                    {!browserLinked && browser.status === "disconnected" ? (
                      <button
                        className="browser-connection"
                        onClick={() => void connect()}
                        disabled={!!busy}
                      >
                        <span className="tiny-status" />
                        {busy === "connecting"
                          ? "Opening Chrome…"
                          : "Connect Reddit in Chrome"}
                        {busy === "connecting" ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <ExternalLink size={13} />
                        )}
                      </button>
                    ) : (
                      <div className="browser-connection">
                        <span
                          className={`tiny-status ${browser.status === "connected" ? "online" : ""}`}
                        />
                        {browser.status === "connecting" ? (
                          <>
                            <LoaderCircle size={13} className="spin" /> Opening
                            Chrome…
                          </>
                        ) : browser.status === "connected" ? (
                          `Connected as u/${browser.username}`
                        ) : browser.status === "login_required" ? (
                          "Waiting for sign-in in Chrome…"
                        ) : browser.status === "disconnected" ? (
                          "Chrome will reopen when you confirm."
                        ) : (
                          "Complete verification in Chrome."
                        )}
                      </div>
                    )}
                  </section>
                </div>
              </div>
              <div className="studio-footer">
                <span>
                  <ShieldCheck size={14} /> Human-approved. Locally executed.
                </span>
                <span>
                  Creative thinking by MiniMax <span>·</span> Browser decisions
                  by JEV <Zap size={12} />
                </span>
              </div>
            </>
          )}
          {view === "chats" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR CONVERSATIONS</div>
                  <h1>
                    Pick up where you left off<span>.</span>
                  </h1>
                  <p>
                    Every conversation keeps its own messages, ideas, and
                    drafts.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => void newDraft()}
                  disabled={!!busy}
                >
                  <Plus size={16} /> New chat
                </button>
              </div>
              <section className="panel list-panel">
                <div className="panel-header">
                  <strong>Chat history</strong>
                  <span className="label-muted">SAVED ON THIS DEVICE</span>
                </div>
                {chats.length ? (
                  chats.map((chat) => (
                    <button
                      key={chat.id}
                      className="chat-history-row"
                      disabled={!!busy}
                      onClick={() => void switchChat(chat.id)}
                    >
                      <span className="history-chat-icon">
                        <MessageSquare size={20} />
                      </span>
                      <div>
                        <strong>{chat.title}</strong>
                        <span>
                          {chat.messageCount} messages ·{" "}
                          {new Intl.DateTimeFormat(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(chat.updatedAt))}
                        </span>
                      </div>
                      {chat.id === activeChatId && (
                        <span className="status-pill success">
                          Current chat
                        </span>
                      )}
                      <ArrowUpRight size={16} />
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <MessageSquare size={28} />
                    <h3>Room for your next idea.</h3>
                    <p>Your conversations will appear here.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {view === "activity" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR PUBLISHING TRAIL</div>
                  <h1>
                    Every little footprint<span>.</span>
                  </h1>
                  <p>
                    Saved drafts, published posts, and what your agent has been
                    doing.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={newDraft}
                  disabled={!!busy}
                >
                  <Plus size={16} /> New chat
                </button>
              </div>
              <div className="stats-grid">
                <div className="stat panel">
                  <span>Saved drafts</span>
                  <strong>{drafts.length}</strong>
                  <Layers3 size={21} />
                </div>
                <div className="stat panel">
                  <span>Published to Reddit</span>
                  <strong>{published}</strong>
                  <CircleCheck size={21} />
                </div>
                <div className="stat panel">
                  <span>Agent events</span>
                  <strong>{activity.length}</strong>
                  <Zap size={21} />
                </div>
              </div>
              <section className="panel list-panel">
                <div className="panel-header">
                  <strong>Your posts</strong>
                  <span className="label-muted">SAVED ON THIS DEVICE</span>
                </div>
                {drafts.length ? (
                  drafts.map((d) => (
                    <button
                      key={d.id}
                      className="draft-row"
                      disabled={!!busy}
                      onClick={() => void switchChat(null, d.id)}
                    >
                      <RedditIcon />
                      <div>
                        <strong>{d.title}</strong>
                        <span>
                          {d.destination} · revision {d.revision}
                        </span>
                      </div>
                      <span className="status-pill">
                        {d.status.replace("_", " ")}
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <Feather size={30} />
                    <h3>The beginning of your story.</h3>
                    <p>Your saved drafts will appear here.</p>
                    <button className="text-button" onClick={newDraft}>
                      Create your first post <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </section>
              <section className="panel list-panel">
                <div className="panel-header">
                  <strong>Agent activity</strong>
                  <Clock3 size={17} />
                </div>
                {activity.length ? (
                  activity.map((a) => (
                    <div key={a.id} className="event-row">
                      <span className="event-dot" />
                      <p>{a.message}</p>
                      <time>{formatTime(a.createdAt)}</time>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <History size={27} />
                    <p>Browser actions and approvals will be recorded here.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {view === "connections" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ONE WORKSPACE. YOUR VOICE.</div>
                  <h1>
                    A home for your channels<span>.</span>
                  </h1>
                  <p>
                    Connect Reddit through the Chrome app already on your
                    device.
                  </p>
                </div>
              </div>
              <section className="panel connection-card">
                <div className="connection-card-head">
                  <RedditIcon />
                  <div>
                    <h2>Reddit</h2>
                    <p>Text posts to communities or your own profile.</p>
                  </div>
                  <span
                    className={`status-pill ${browser.status === "connected" ? "success" : ""}`}
                  >
                    {browser.status === "connected"
                      ? "Connected"
                      : "Not connected"}
                  </span>
                </div>
                <p className="connection-description">
                  DinoPost opens a dedicated, persistent Chrome profile. Sign in
                  there once; your session stays in Chrome. DinoPost checks your
                  account and asks you to log in whenever needed.
                </p>
                <div className="connection-info">
                  <ShieldCheck size={18} />
                  <p>
                    No passwords stored by DinoPost. No browser screenshots sent
                    to either model.
                  </p>
                </div>
                <p className="browser-message">{browser.message}</p>
                {!browserLinked && browser.status === "disconnected" ? (
                  <button
                    className="button primary"
                    disabled={!!busy}
                    onClick={() => void connect()}
                  >
                    {busy === "connecting" ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <ExternalLink size={16} />
                    )}
                    Open Chrome & connect
                  </button>
                ) : (
                  <p className="connection-automatic">
                    <CircleCheck size={16} /> Chrome opens with DinoPost.
                    Sign-in is detected automatically; if you close Chrome, it
                    reopens when you confirm a post.
                  </p>
                )}
              </section>
              <div className="future-platforms">
                <span>GROWING WITH YOU</span>
                <h3>More places to leave your mark.</h3>
                <p>Facebook and Instagram are planned for a later release.</p>
                <div>
                  <span>
                    Facebook <small>PLANNED</small>
                  </span>
                  <span>
                    Instagram <small>PLANNED</small>
                  </span>
                </div>
              </div>
            </>
          )}
          {view === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">BEHIND THE SCENES</div>
                  <h1>
                    A thoughtful little setup<span>.</span>
                  </h1>
                  <p>Two specialized models. One simple publishing flow.</p>
                </div>
              </div>
              <section className="panel settings-panel">
                <div className="panel-header">
                  <div className="section-title">
                    <Sparkles size={18} />
                    <strong>Agent models</strong>
                  </div>
                  <span className="label-muted">KEYS STAY ON YOUR DEVICE</span>
                </div>
                <div className="setting-group">
                  <div className="setting-title">
                    <span className="model-icon">
                      <Sparkles size={19} />
                    </span>
                    <div>
                      <h3>MiniMax M3.1 Flash</h3>
                      <p>Thinks with you. Writes in your voice.</p>
                    </div>
                    <span
                      className={`status-pill ${config.nvidiaConfigured ? "success" : ""}`}
                    >
                      {config.nvidiaConfigured ? "Configured" : "Key needed"}
                    </span>
                  </div>
                  <label>
                    NVIDIA API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={nvidiaKey}
                      onChange={(e) => setNvidiaKey(e.target.value)}
                      placeholder={
                        config.nvidiaConfigured
                          ? "Key configured · enter a new key to replace it"
                          : "nvapi-…"
                      }
                    />
                  </label>
                  <span className="setting-detail">
                    NVIDIA NIM · {config.model}
                  </span>
                </div>
                <div className="setting-group">
                  <div className="setting-title">
                    <span className="model-icon jev">
                      <Zap size={19} />
                    </span>
                    <div>
                      <h3>JEV</h3>
                      <p>
                        Makes fast browser decisions from structured page data.
                      </p>
                    </div>
                    <span
                      className={`status-pill ${config.typesafeConfigured ? "success" : ""}`}
                    >
                      {config.typesafeConfigured ? "Configured" : "Key needed"}
                    </span>
                  </div>
                  <label>
                    TypeSafe API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={typesafeKey}
                      onChange={(e) => setTypesafeKey(e.target.value)}
                      placeholder={
                        config.typesafeConfigured
                          ? "Key configured · enter a new key to replace it"
                          : "apikey_…"
                      }
                    />
                  </label>
                  <span className="setting-detail">
                    TypeSafe · {config.browserModel} · no screenshot loop
                  </span>
                </div>
                <div className="settings-footer">
                  <p>
                    <ShieldCheck size={16} /> Saved in Windows Credential
                    Manager.
                  </p>
                  <button
                    className="button primary"
                    disabled={
                      !!busy || (!nvidiaKey.trim() && !typesafeKey.trim())
                    }
                    onClick={() => void saveKeys()}
                  >
                    {busy === "settings" ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Check size={15} />
                    )}{" "}
                    Save settings
                  </button>
                </div>
              </section>
              <div className="settings-note">
                <Info size={17} />
                <p>
                  For local development, keys can also be loaded from a
                  gitignored <code>.env</code> file. Model requests run in Rust;
                  API keys are never sent to the React interface.
                </p>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
