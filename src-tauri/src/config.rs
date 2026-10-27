use serde::Serialize;
use std::{collections::HashMap, path::Path};

#[derive(Default)]
pub struct Config {
    pub nvidia: String,
    pub typesafe: String,
    pub chrome: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatus {
    pub nvidia_configured: bool,
    pub typesafe_configured: bool,
    pub model: &'static str,
    pub browser_model: &'static str,
}

impl Config {
    pub fn load() -> Self {
        let mut local = HashMap::new();
        let mut paths = vec![Path::new(".env").to_path_buf()];
        if cfg!(debug_assertions) {
            paths.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env"));
        }
        for path in paths {
            if let Ok(values) = dotenvy::from_path_iter(path) {
                for (key, value) in values.flatten() {
                    local.entry(key).or_insert(value);
                }
            }
        }
        let get = |name: &str| {
            std::env::var(name)
                .ok()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    keyring::Entry::new("DinoPost", name)
                        .ok()?
                        .get_password()
                        .ok()
                        .filter(|s| !s.trim().is_empty())
                })
                .or_else(|| local.get(name).cloned())
                .unwrap_or_default()
        };
        Self {
            nvidia: get("NVIDIA_API_KEY"),
            typesafe: get("TYPESAFE_API_KEY"),
            chrome: std::env::var("DINOPOST_CHROME_PATH")
                .ok()
                .or_else(|| local.get("DINOPOST_CHROME_PATH").cloned()),
        }
    }

    pub fn status(&self) -> ConfigStatus {
        ConfigStatus {
            nvidia_configured: !self.nvidia.is_empty(),
            typesafe_configured: !self.typesafe.is_empty(),
            model: crate::providers::MODEL,
            browser_model: "jev-latest",
        }
    }

    pub fn save(&mut self, nvidia: Option<String>, typesafe: Option<String>) -> Result<(), String> {
        for (name, value) in [("NVIDIA_API_KEY", nvidia), ("TYPESAFE_API_KEY", typesafe)] {
            if let Some(value) = value.filter(|s| !s.trim().is_empty()) {
                keyring::Entry::new("DinoPost", name)
                    .map_err(|_| "Could not access Windows Credential Manager.".to_string())?
                    .set_password(value.trim())
                    .map_err(|_| {
                        "Could not save the API key to Windows Credential Manager.".to_string()
                    })?;
                if name == "NVIDIA_API_KEY" {
                    self.nvidia = value.trim().into();
                } else {
                    self.typesafe = value.trim().into();
                }
            }
        }
        Ok(())
    }
}
