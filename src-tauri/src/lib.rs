mod browser;
mod config;
mod domain;
mod providers;
mod reddit;
mod store;

use browser::{submit_url, verify_post, Browser};
use config::{Config, ConfigStatus};
use domain::{Activity, BrowserStatus, ChatSession, Draft, Message};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use store::Store;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex as AsyncMutex;

struct AppState {
    db: Mutex<Store>,
    config: Mutex<Config>,
    browser: AsyncMutex<Browser>,
    work: AsyncMutex<()>,
    browser_status: Mutex<BrowserStatus>,
    browser_watch: AtomicU64,
}

impl AppState {
    fn db(&self) -> Result<std::sync::MutexGuard<'_, Store>, String> {
        self.db
            .lock()
            .map_err(|_| "Local database is unavailable.".into())
    }
    fn config(&self) -> Result<std::sync::MutexGuard<'_, Config>, String> {
        self.config
            .lock()
            .map_err(|_| "Settings are unavailable.".into())
    }
    fn log(&self, app: &tauri::AppHandle, id: Option<&str>, message: &str) -> Result<(), String> {
        self.db()?.log(id, message)?;
        let _ = app.emit("activity-updated", message);
        Ok(())
    }
    fn set_browser_status(
        &self,
        app: &tauri::AppHandle,
        status: BrowserStatus,
    ) -> Result<(), String> {
        if status.status == "connected" {
            self.db()?.set_setting("reddit_linked", "true")?;
        }
        *self
            .browser_status
            .lock()
            .map_err(|_| "Browser status is unavailable.".to_string())? = status.clone();
        let _ = app.emit("browser-status", &status);
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    drafts: Vec<Draft>,
    messages: Vec<Message>,
    activity: Vec<Activity>,
    config: ConfigStatus,
    chats: Vec<ChatSession>,
    active_chat_id: String,
    active_draft_id: Option<String>,
    browser: BrowserStatus,
    browser_linked: bool,
}

#[tauri::command]
fn bootstrap(state: State<'_, AppState>) -> Result<Bootstrap, String> {
    let db = state.db()?;
    let active_chat_id = db.active_chat()?;
    let chats = db.chats()?;
    let active_draft_id = chats
        .iter()
        .find(|c| c.id == active_chat_id)
        .and_then(|c| c.draft_id.clone());
    Ok(Bootstrap {
        drafts: db.drafts()?,
        messages: db.messages(&active_chat_id)?,
        activity: db.activity()?,
        config: state.config()?.status(),
        chats,
        active_chat_id,
        active_draft_id,
        browser: state
            .browser_status
            .lock()
            .map_err(|_| "Browser status is unavailable.".to_string())?
            .clone(),
        browser_linked: db.setting("reddit_linked").as_deref() == Some("true"),
    })
}

#[tauri::command]
async fn new_chat(state: State<'_, AppState>) -> Result<Bootstrap, String> {
    let _work = state
        .work
        .try_lock()
        .map_err(|_| "Wait for the current task to finish.".to_string())?;
    state.db()?.new_chat()?;
    drop(_work);
    bootstrap(state)
}

#[tauri::command]
async fn switch_chat(
    state: State<'_, AppState>,
    id: Option<String>,
    draft_id: Option<String>,
) -> Result<Bootstrap, String> {
    let _work = state
        .work
        .try_lock()
        .map_err(|_| "Wait for the current task to finish.".to_string())?;
    let id = match id {
        Some(id) => id,
        None => state
            .db()?
            .draft_chat(draft_id.as_deref().ok_or("Select a chat or a draft.")?)?,
    };
    if let Some(draft) = draft_id.as_deref() {
        state.db()?.require_draft_chat(&id, draft)?;
    }
    state.db()?.switch_chat(&id)?;
    drop(_work);
    let mut data = bootstrap(state)?;
    if draft_id.is_some() {
        data.active_draft_id = draft_id;
    }
    Ok(data)
}

#[tauri::command]
fn save_settings(
    state: State<'_, AppState>,
    nvidia: Option<String>,
    typesafe: Option<String>,
) -> Result<ConfigStatus, String> {
    let mut config = state.config()?;
    config.save(nvidia, typesafe)?;
    Ok(config.status())
}

#[tauri::command]
fn save_draft(
    state: State<'_, AppState>,
    id: Option<String>,
    revision: Option<i64>,
    destination: String,
    title: String,
    body: String,
    chat_id: String,
) -> Result<Draft, String> {
    state.db()?.save_for_chat(
        &chat_id,
        id.as_deref(),
        revision,
        &destination,
        &title,
        &body,
    )
}

#[derive(Serialize)]
struct ChatReply {
    message: Message,
    draft: Draft,
}

#[tauri::command]
async fn chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    content: String,
    destination: String,
    draft_id: Option<String>,
    chat_id: String,
) -> Result<ChatReply, String> {
    let _work = state
        .work
        .try_lock()
        .map_err(|_| "Another agent task is running. Please wait.".to_string())?;
    if content.trim().is_empty() || content.chars().count() > 6000 {
        return Err("Send a message between 1 and 6,000 characters.".into());
    }
    domain::validate_content(&destination, "Draft", "")?;
    let key = state.config()?.nvidia.clone();
    if key.is_empty() {
        return Err("Add your NVIDIA API key in Settings to chat with MiniMax.".into());
    }
    let (mut messages, current) = {
        let db = state.db()?;
        db.require_chat(&chat_id)?;
        if let Some(id) = draft_id.as_deref() {
            db.require_draft_chat(&chat_id, id)?;
        }
        (
            db.messages(&chat_id)?,
            draft_id.as_deref().map(|id| db.get(id)).transpose()?,
        )
    };
    messages.push(Message {
        role: "user".into(),
        content: content.clone(),
    });
    let suggestion = providers::chat(&key, &messages, &destination, current.as_ref()).await?;
    let db = state.db()?;
    let editable = current
        .as_ref()
        .filter(|d| ["draft", "blocked", "waiting_login"].contains(&d.status.as_str()));
    let draft = db.save_for_chat(
        &chat_id,
        editable.map(|d| d.id.as_str()),
        editable.map(|d| d.revision),
        &destination,
        &suggestion.title,
        &suggestion.body,
    )?;
    db.message(&chat_id, "user", &content)?;
    db.message(&chat_id, "assistant", &suggestion.message)?;
    drop(db);
    state.log(
        &app,
        Some(&draft.id),
        "MiniMax prepared a draft. Waiting for your confirmation.",
    )?;
    Ok(ChatReply {
        message: Message {
            role: "assistant".into(),
            content: suggestion.message,
        },
        draft,
    })
}

#[tauri::command]
async fn connect_reddit(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserStatus, String> {
    let _work = state
        .work
        .try_lock()
        .map_err(|_| "Another agent task is running. Please wait.".to_string())?;
    open_reddit(&app).await
}

async fn open_reddit(app: &tauri::AppHandle) -> Result<BrowserStatus, String> {
    let state = app.state::<AppState>();
    state.log(
        app,
        None,
        "Opening installed Chrome and checking Reddit login.",
    )?;
    let mut browser = state.browser.lock().await;
    let status = browser.login_status().await?;
    drop(browser);
    state.db()?.set_setting("reddit_linked", "true")?;
    state.set_browser_status(app, status.clone())?;
    state.log(app, None, &status.message)?;
    watch_sign_in(app.clone(), status.status != "connected");
    Ok(status)
}

fn watch_sign_in(app: tauri::AppHandle, needed: bool) {
    let generation = app
        .state::<AppState>()
        .browser_watch
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    if !needed {
        return;
    }
    tauri::async_runtime::spawn(async move {
        for _ in 0..120 {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let state = app.state::<AppState>();
            if state.browser_watch.load(Ordering::SeqCst) != generation {
                return;
            }
            let Ok(mut browser) = state.browser.try_lock() else {
                continue;
            };
            // Never restart a window closed by the user from a polling task.
            if !browser.is_open().await {
                let _ = state.set_browser_status(
                    &app,
                    BrowserStatus {
                        status: "disconnected".into(),
                        username: None,
                        message: "Chrome is closed. It will reopen when you confirm a post.".into(),
                    },
                );
                return;
            }
            if let Ok(status) = browser.read_login_status().await {
                let connected = status.status == "connected";
                let _ = state.set_browser_status(&app, status.clone());
                if connected {
                    let _ = state.log(&app, None, &status.message);
                    return;
                }
            }
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishResult {
    draft: Draft,
    browser: BrowserStatus,
    message: String,
}

// Only this command can transition a draft into a publish attempt. The frontend
// invokes it from the explicit confirmation button with the displayed revision.
#[tauri::command]
async fn approve_and_post(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    revision: i64,
) -> Result<PublishResult, String> {
    let _work = state
        .work
        .try_lock()
        .map_err(|_| "Another agent task is running. Please wait.".to_string())?;
    let key = state.config()?.typesafe.clone();
    if key.is_empty() {
        return Err("Add your TypeSafe API key in Settings before publishing with JEV.".into());
    }
    let draft = state.db()?.claim(&id, revision)?;
    state.log(
        &app,
        Some(&id),
        &format!(
            "You confirmed revision {} for {}. Starting Chrome.",
            revision, draft.destination
        ),
    )?;
    let mut browser = state.browser.lock().await;
    let result = publish(&app, &state, &mut browser, &draft, &key).await;
    match result {
        Ok(result) => Ok(result),
        Err(error) => {
            let current = state.db()?.get(&id)?;
            let uncertain = current.status == "submitting";
            state
                .db()?
                .status(&id, if uncertain { "uncertain" } else { "blocked" }, None)?;
            let message = if uncertain {
                format!("Submission may have completed. Check Chrome before creating another post. Automatic retry is disabled. {error}")
            } else {
                error
            };
            state.log(&app, Some(&id), &message)?;
            Err(message)
        }
    }
}

async fn publish(
    app: &tauri::AppHandle,
    state: &AppState,
    browser: &mut Browser,
    draft: &Draft,
    key: &str,
) -> Result<PublishResult, String> {
    let identity = browser.login_status().await?;
    state.set_browser_status(app, identity.clone())?;
    if identity.status != "connected" {
        watch_sign_in(app.clone(), true);
        let status = if identity.status == "login_required" {
            "waiting_login"
        } else {
            "blocked"
        };
        let draft = state.db()?.status(&draft.id, status, None)?;
        state.log(app, Some(&draft.id), &identity.message)?;
        return Ok(PublishResult {
            draft,
            browser: identity.clone(),
            message: identity.message,
        });
    }
    if let Some(username) = draft.destination.strip_prefix("u/") {
        if !identity
            .username
            .as_deref()
            .is_some_and(|s| s.eq_ignore_ascii_case(username))
        {
            return Err(
                "The approved profile destination does not match the logged-in Reddit account."
                    .into(),
            );
        }
    }
    state.log(
        app,
        Some(&draft.id),
        "Reddit login verified. Opening the approved destination.",
    )?;
    browser.navigate(&submit_url(draft)).await?;
    let mut history = Vec::<String>::new();
    for step in 0..20 {
        let page = browser.snapshot().await?;
        if page["blocked"] == true {
            return Err("Reddit requires verification or is blocking this connection. Resolve it in Chrome.".into());
        }
        let current = state.db()?.get(&draft.id)?;
        if current.status == "submitting" {
            if let Some(url) = verify_post(&page, draft) {
                let saved = state.db()?.status(&draft.id, "published", Some(&url))?;
                state.log(
                    app,
                    Some(&draft.id),
                    "Published. Verified the Reddit permalink, destination, and approved content.",
                )?;
                return Ok(PublishResult {
                    draft: saved,
                    browser: identity,
                    message: "Your post is live on Reddit.".into(),
                });
            }
            tokio::time::sleep(Duration::from_millis(750)).await;
            continue;
        }
        let url = page["url"]
            .as_str()
            .ok_or("Could not read the Reddit page address.")?;
        let expected = submit_url(draft);
        if !domain::is_reddit_url(url)
            || reqwest::Url::parse(url)
                .map_err(|_| "Invalid Reddit URL.")?
                .path()
                .trim_end_matches('/')
                != reqwest::Url::parse(&expected)
                    .map_err(|_| "Invalid destination.")?
                    .path()
        {
            return Err(
                "Chrome left the approved Reddit composer. Check the destination and try again."
                    .into(),
            );
        }
        let controls = page["controls"]
            .as_array()
            .ok_or("Could not read the Reddit composer.")?;
        let composer = reddit::Composer::read(&page, draft)?;
        let (title, body) = (composer.title, composer.body);
        let (title_ready, body_ready, destination_ready) = (
            composer.title_ready,
            composer.body_ready,
            composer.destination_ready,
        );
        if page["attachedFiles"] == true {
            return Err("The composer contains an attachment that was not approved. V1 supports text posts only.".into());
        }
        let mut actions: HashMap<String, (Value, Option<String>)> = HashMap::new();
        if !title_ready {
            if let Some(t) = title {
                actions.insert("fill_title".into(), (t.clone(), Some(draft.title.clone())));
            }
        }
        if !body_ready {
            if let Some(b) = body {
                actions.insert("fill_body".into(), (b.clone(), Some(draft.body.clone())));
            }
        }
        for c in controls {
            let label = c["label"].as_str().unwrap_or("").to_lowercase();
            if ["text", "text post"].contains(&label.as_str())
                && c["selected"] != true
                && (c["role"] == "tab" || c["tag"] == "button")
                && (title.is_none()
                    || controls.iter().any(|other| {
                        other["role"] == "tab"
                            && other["selected"] == true
                            && other["id"] != c["id"]
                    }))
            {
                actions.insert("text_post".into(), (c.clone(), None));
            }
        }
        if let Some(button) = composer.post_button {
            actions.insert("submit".into(), (button.clone(), None));
        }
        let mut options = HashMap::from([("WAIT".to_string(),json!("Wait briefly if the composer is still loading.")),("BLOCKED".to_string(),json!("Stop: the form requires unsupported input, rules acceptance, flair, login, CAPTCHA, or cannot progress."))]);
        for (name, (control, _)) in &actions {
            options.insert(name.clone(),json!({"action":name,"observed_control":control,"description":if name=="submit" {"Submit the exact approved post once. Title, body and destination were checked by code."} else {"Apply this approved field or select the text post type."}}));
        }
        // The human already approved this exact post. Clicking the verified
        // native submit control is deterministic and needs no model decision.
        let choice = if actions.contains_key("submit") {
            "submit".to_owned()
        } else {
            providers::choose(key,json!({"approved":{"destination":draft.destination,"title":draft.title,"body":draft.body},"page":{"url":page["url"],"title":page["title"],"text":page["text"],"selected_destinations":page["destinations"]},"available_actions":actions.keys().collect::<Vec<_>>(),"title_matches":title_ready,"body_matches":body_ready,"destination_matches":destination_ready,"recent_actions":history}),options).await?
        };
        if choice == "BLOCKED" {
            return Err(composer.blocked_reason(&page));
        }
        if choice == "WAIT" {
            if history.iter().rev().take(3).all(|s| s == "WAIT") && history.len() >= 3 {
                return Err(
                    "The Reddit composer is not progressing. Check Chrome before retrying.".into(),
                );
            }
            tokio::time::sleep(Duration::from_millis(750)).await;
        } else {
            let (control, text) = actions
                .get(&choice)
                .ok_or("JEV chose an unavailable control.")?;
            if choice == "submit" {
                // Persist BEFORE the click. On any error/crash, the next launch
                // refuses another submit because its outcome may be unknown.
                state.db()?.status(&draft.id, "submitting", None)?;
            }
            state.log(
                app,
                Some(&draft.id),
                &format!(
                    "{} · step {} · {}",
                    if choice == "submit" { "Reddit" } else { "JEV" },
                    step + 1,
                    if choice == "submit" {
                        "click Post".into()
                    } else {
                        choice.replace('_', " ")
                    }
                ),
            )?;
            if choice == "submit" {
                browser.click_post(&page, draft).await?;
            } else {
                browser
                    .interact(&page, control, text.as_deref(), None)
                    .await?;
            }
        }
        history.push(choice);
    }
    Err(
        "The browser reached its 20-step limit without a verified post. Please check Chrome."
            .into(),
    )
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let config = Config::load();
            let browser = Browser::new(browser::profile_path(&data_dir), config.chrome.clone());
            let db =
                Store::open(&data_dir.join("dinopost.sqlite3")).map_err(std::io::Error::other)?;
            let linked = db.setting("reddit_linked").as_deref() == Some("true");
            app.manage(AppState {
                db: Mutex::new(db),
                config: Mutex::new(config),
                browser: AsyncMutex::new(browser),
                work: AsyncMutex::new(()),
                browser_status: Mutex::new(BrowserStatus {
                    status: if linked { "connecting" } else { "disconnected" }.into(),
                    username: None,
                    message: if linked {
                        "Opening Chrome…"
                    } else {
                        "Connect Reddit once to get started."
                    }
                    .into(),
                }),
                browser_watch: AtomicU64::new(0),
            });
            if linked {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(message) = open_reddit(&handle).await {
                        let _ = handle.state::<AppState>().set_browser_status(
                            &handle,
                            BrowserStatus {
                                status: "blocked".into(),
                                username: None,
                                message,
                            },
                        );
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            save_settings,
            save_draft,
            chat,
            connect_reddit,
            approve_and_post,
            new_chat,
            switch_chat
        ])
        .run(tauri::generate_context!())
        .expect("Could not run DinoPost");
}
