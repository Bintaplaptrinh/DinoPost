use crate::domain::{is_reddit_url, BrowserStatus, Draft};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{
    net::TcpStream,
    time::{sleep, timeout},
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

pub struct Browser {
    socket: Option<WebSocketStream<MaybeTlsStream<TcpStream>>>,
    seq: u64,
    profile: PathBuf,
    chrome_override: Option<String>,
}

impl Browser {
    pub fn new(profile: PathBuf, chrome_override: Option<String>) -> Self {
        Self {
            socket: None,
            seq: 0,
            profile,
            chrome_override,
        }
    }

    fn chrome(&self) -> Result<PathBuf, String> {
        let mut candidates = Vec::new();
        if let Some(path) = &self.chrome_override {
            candidates.push(PathBuf::from(path));
        }
        for base in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
            if let Some(dir) = std::env::var_os(base) {
                candidates.push(PathBuf::from(dir).join("Google/Chrome/Application/chrome.exe"));
            }
        }
        candidates
            .into_iter()
            .find(|p| p.is_file())
            .ok_or("Google Chrome was not found. Set DINOPOST_CHROME_PATH in .env.".into())
    }

    async fn endpoint(&self) -> Option<String> {
        let data = std::fs::read_to_string(self.profile.join("DevToolsActivePort")).ok()?;
        let port = data.lines().next()?.parse::<u16>().ok()?;
        if port == 0 {
            return None;
        }
        let base = format!("http://127.0.0.1:{port}");
        let response = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .ok()?
            .get(format!("{base}/json/version"))
            .send()
            .await
            .ok()?;
        let info: Value = response.json().await.ok()?;
        info["Browser"].as_str().filter(|s| s.contains("Chrome"))?;
        Some(base)
    }

    pub async fn is_open(&mut self) -> bool {
        self.socket.is_some()
            && self
                .call(
                    "Runtime.evaluate",
                    json!({"expression":"1","returnByValue":true}),
                )
                .await
                .is_ok()
    }

    pub async fn ensure(&mut self) -> Result<(), String> {
        if self.socket.is_some()
            && self
                .call(
                    "Runtime.evaluate",
                    json!({"expression":"1","returnByValue":true}),
                )
                .await
                .is_ok()
        {
            return Ok(());
        }
        self.socket = None;
        std::fs::create_dir_all(&self.profile)
            .map_err(|_| "Cannot create the DinoPost Chrome profile.".to_string())?;
        let mut endpoint = self.endpoint().await;
        if endpoint.is_none() {
            let mut command = std::process::Command::new(self.chrome()?);
            command
                .arg(format!("--user-data-dir={}", self.profile.display()))
                .args([
                    "--remote-debugging-port=0",
                    "--remote-debugging-address=127.0.0.1",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "https://www.reddit.com/",
                ]);
            command
                .spawn()
                .map_err(|_| "Could not launch Google Chrome.".to_string())?;
            for _ in 0..60 {
                sleep(Duration::from_millis(250)).await;
                endpoint = self.endpoint().await;
                if endpoint.is_some() {
                    break;
                }
            }
        }
        let base = endpoint.ok_or("Chrome did not expose its local connection. Close only the DinoPost Chrome window and try again.")?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|_| "Cannot connect to Chrome.".to_string())?;
        // Create one owned tab; do not attach to, inspect, or navigate unrelated tabs.
        let target: Value = client
            .put(format!("{base}/json/new?https://www.reddit.com/"))
            .send()
            .await
            .map_err(|_| "Could not create a Reddit tab.".to_string())?
            .json()
            .await
            .map_err(|_| "Chrome returned an invalid tab.".to_string())?;
        let ws = target["webSocketDebuggerUrl"]
            .as_str()
            .ok_or("Chrome did not return a tab connection.")?;
        let url = reqwest::Url::parse(ws).map_err(|_| "Invalid Chrome endpoint.".to_string())?;
        if url.scheme() != "ws" || !matches!(url.host_str(), Some("127.0.0.1" | "localhost")) {
            return Err("Chrome connection must use loopback.".into());
        }
        let (socket, _) = timeout(Duration::from_secs(8), connect_async(ws))
            .await
            .map_err(|_| "Chrome connection timed out.".to_string())?
            .map_err(|_| "Could not connect to the Reddit tab.".to_string())?;
        self.socket = Some(socket);
        self.call("Page.enable", json!({})).await?;
        self.call("Page.bringToFront", json!({})).await?;
        self.wait_document().await
    }

    pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.seq += 1;
        let id = self.seq;
        let socket = self.socket.as_mut().ok_or("Chrome is not connected.")?;
        let work = async {
            socket
                .send(Message::Text(
                    json!({"id":id,"method":method,"params":params})
                        .to_string()
                        .into(),
                ))
                .await
                .map_err(|_| "Chrome disconnected.".to_string())?;
            while let Some(message) = socket.next().await {
                let message = message.map_err(|_| "Chrome disconnected.".to_string())?;
                if let Message::Text(text) = message {
                    let value: Value = serde_json::from_str(&text)
                        .map_err(|_| "Invalid Chrome response.".to_string())?;
                    if value["id"].as_u64() == Some(id) {
                        if value.get("error").is_some() {
                            return Err("Chrome could not complete that browser action.".into());
                        }
                        return Ok(value["result"].clone());
                    }
                }
            }
            Err("Chrome closed the tab connection.".into())
        };
        timeout(Duration::from_secs(18), work)
            .await
            .map_err(|_| "Chrome action timed out.".to_string())?
    }

    pub async fn eval(&mut self, expression: &str) -> Result<Value, String> {
        let result = self
            .call(
                "Runtime.evaluate",
                json!({"expression":expression,"returnByValue":true,"awaitPromise":true}),
            )
            .await?;
        if result.get("exceptionDetails").is_some() {
            return Err(
                "The Reddit page changed or could not be read. Please check Chrome.".into(),
            );
        }
        Ok(result["result"]["value"].clone())
    }

    async fn wait_document(&mut self) -> Result<(), String> {
        for _ in 0..40 {
            if self
                .eval("document.readyState")
                .await
                .is_ok_and(|v| v == "complete")
            {
                return Ok(());
            }
            sleep(Duration::from_millis(250)).await;
        }
        Err("Reddit is still loading. Check Chrome and try again.".into())
    }

    pub async fn navigate(&mut self, url: &str) -> Result<(), String> {
        if !is_reddit_url(url) {
            return Err("Only https://www.reddit.com is supported in v1.".into());
        }
        self.call("Page.navigate", json!({"url":url})).await?;
        sleep(Duration::from_millis(500)).await;
        self.wait_document().await
    }

    pub async fn snapshot(&mut self) -> Result<Value, String> {
        self.eval(include_str!("snapshot.js")).await
    }

    pub async fn login_status(&mut self) -> Result<BrowserStatus, String> {
        self.ensure().await?;
        self.read_login_status().await
    }

    pub async fn read_login_status(&mut self) -> Result<BrowserStatus, String> {
        let url = self.eval("location.href").await?;
        if !url.as_str().is_some_and(is_reddit_url) {
            self.navigate("https://www.reddit.com/").await?;
        }
        let page = self.snapshot().await?;
        if page["blocked"] == true {
            return Ok(BrowserStatus{status:"blocked".into(),username:None,message:"Reddit is showing a network block or verification challenge. Resolve it in Chrome before continuing.".into()});
        }
        // This same-origin read checks the active account without exporting cookies or passwords.
        let identity = self.eval("(async()=>{if(location.origin!=='https://www.reddit.com')return {status:0}; const r=await fetch('/api/me.json',{credentials:'same-origin',signal:AbortSignal.timeout(10000)}); if(!r.ok)return {status:r.status}; const j=await r.json(); return {status:200,name:j?.data?.name||null};})()").await?;
        if let Some(name) = identity["name"].as_str().filter(|v| !v.is_empty()) {
            return Ok(BrowserStatus {
                status: "connected".into(),
                username: Some(name.into()),
                message: format!("Connected to Reddit as u/{name}."),
            });
        }
        let login_visible = page["controls"].as_array().is_some_and(|controls| {
            controls.iter().any(|c| {
                c["label"].as_str().is_some_and(|s| {
                    ["log in", "login", "sign in"].contains(&s.to_lowercase().as_str())
                })
            })
        });
        if identity["status"] == 200
            || identity["status"] == 401
            || (identity["status"] == 403 && login_visible)
        {
            return Ok(BrowserStatus{status:"login_required".into(),username:None,message:"Log in to Reddit in the Chrome window. DinoPost will detect your sign-in automatically; return here to confirm your post.".into()});
        }
        Ok(BrowserStatus{status:"blocked".into(),username:None,message:format!("Reddit account check returned HTTP {}. Check the Chrome window for a login or network restriction; no post was submitted.",identity["status"] )})
    }

    pub async fn click_post(&mut self, page: &Value, approved: &Draft) -> Result<(), String> {
        let composer = crate::reddit::Composer::read(page, approved)?;
        let button = composer
            .post_button
            .ok_or_else(|| composer.blocked_reason(page))?;
        self.interact(page, button, None, Some(approved)).await
    }

    pub async fn interact(
        &mut self,
        page: &Value,
        control: &Value,
        text: Option<&str>,
        approved: Option<&Draft>,
    ) -> Result<(), String> {
        let arg = json!({"token":page["token"],"id":control["id"],"label":control["label"],"value":control["value"],"editable":control["editable"],"approved":approved});
        let guard = include_str!("interact.js").trim().trim_end_matches(';');
        let expression = format!("({guard})({arg})");
        let point = self.eval(&expression).await?;
        let x = point["x"]
            .as_f64()
            .ok_or("The selected control moved or is covered. No action executed.")?;
        let y = point["y"]
            .as_f64()
            .ok_or("The selected control is not visible.")?;
        for kind in ["mousePressed", "mouseReleased"] {
            self.call(
                "Input.dispatchMouseEvent",
                json!({"type":kind,"x":x,"y":y,"button":"left","clickCount":1}),
            )
            .await?;
        }
        if let Some(text) = text {
            self.call("Input.dispatchKeyEvent",json!({"type":"rawKeyDown","key":"a","code":"KeyA","windowsVirtualKeyCode":65,"modifiers":2})).await?;
            self.call("Input.dispatchKeyEvent",json!({"type":"keyUp","key":"a","code":"KeyA","windowsVirtualKeyCode":65,"modifiers":2})).await?;
            self.call("Input.insertText", json!({"text":text})).await?;
        }
        sleep(Duration::from_millis(350)).await;
        Ok(())
    }
}

pub fn verify_post(page: &Value, draft: &Draft) -> Option<String> {
    let raw = page["url"].as_str()?;
    if !is_reddit_url(raw) {
        return None;
    }
    let url = reqwest::Url::parse(raw).ok()?;
    let path = url.path().to_lowercase();
    let destination = if let Some(name) = draft.destination.strip_prefix("u/") {
        format!("user/{}", name.to_lowercase())
    } else {
        draft.destination.to_lowercase()
    };
    if !path.starts_with(&format!("/{destination}/comments/")) {
        return None;
    }
    let title_matches = page["titles"]
        .as_array()?
        .iter()
        .any(|t| t.as_str() == Some(draft.title.trim()));
    let normalize = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let body_matches = draft.body.trim().is_empty()
        || page["posts"].as_array().is_some_and(|posts| {
            posts.iter().any(|p| {
                p.as_str()
                    .is_some_and(|s| normalize(s).contains(&normalize(&draft.body)))
            })
        });
    (title_matches && body_matches).then(|| raw.to_owned())
}

pub fn submit_url(draft: &Draft) -> String {
    let destination = draft.destination.replacen("u/", "user/", 1);
    format!("https://www.reddit.com/{destination}/submit?type=TEXT")
}

pub fn profile_path(data_dir: &Path) -> PathBuf {
    data_dir.join("chrome-profile")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn done_requires_matching_destination_title_and_body() {
        let d = Draft {
            id: "x".into(),
            revision: 1,
            destination: "r/test".into(),
            title: "Hello".into(),
            body: "Approved body".into(),
            status: "submitting".into(),
            post_url: None,
            updated_at: String::new(),
        };
        let good = json!({"url":"https://www.reddit.com/r/test/comments/abc/hello/","titles":["Hello"],"posts":["Hello Approved body"]});
        assert!(verify_post(&good, &d).is_some());
        for page in [
            json!({"url":"https://www.reddit.com/r/other/comments/abc/","titles":["Hello"],"posts":["Approved body"]}),
            json!({"url":"https://www.reddit.com/r/test/submit","titles":["Hello"],"posts":["Approved body"]}),
            json!({"url":"https://www.reddit.com/r/test/comments/abc/","titles":["Wrong"],"posts":["Approved body"]}),
        ] {
            assert!(verify_post(&page, &d).is_none());
        }
    }
}
