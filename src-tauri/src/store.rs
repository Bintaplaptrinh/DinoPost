use crate::domain::{validate_content, Activity, ChatSession, Draft, Message};
use chrono::Utc;
use rusqlite::{params, Connection};
use std::path::Path;
use uuid::Uuid;

pub struct Store(pub Connection);

fn err(e: rusqlite::Error) -> String {
    format!("Local database error: {e}")
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let db = Connection::open(path).map_err(err)?;
        db.execute_batch("PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, destination TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, post_url TEXT, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, draft_id TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL);
            UPDATE drafts SET status='uncertain' WHERE status='submitting';
            UPDATE drafts SET status='blocked' WHERE status='running';").map_err(err)?;
        let store = Self(db);
        store.migrate_chats()?;
        Ok(store)
    }

    fn migrate_chats(&self) -> Result<(), String> {
        let tx = self.0.unchecked_transaction().map_err(err)?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS chat_drafts (draft_id TEXT PRIMARY KEY REFERENCES drafts(id), chat_id TEXT NOT NULL REFERENCES chats(id));").map_err(err)?;
        let has_chat_id = {
            let mut q = tx.prepare("PRAGMA table_info(messages)").map_err(err)?;
            let rows = q.query_map([], |r| r.get::<_, String>(1)).map_err(err)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(err)?
                .iter()
                .any(|name| name == "chat_id")
        };
        if !has_chat_id {
            tx.execute("ALTER TABLE messages ADD COLUMN chat_id TEXT", [])
                .map_err(err)?;
        }
        let count: i64 = tx
            .query_row("SELECT COUNT(*) FROM chats", [], |r| r.get(0))
            .map_err(err)?;
        if count == 0 {
            let first = tx
                .query_row(
                    "SELECT content FROM messages WHERE role='user' ORDER BY id LIMIT 1",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .ok();
            let title = first
                .map(|s| s.chars().take(60).collect::<String>())
                .unwrap_or("New chat".into());
            let now = Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO chats VALUES (?1,?2,?3,?3)",
                params![Uuid::new_v4().to_string(), title, now],
            )
            .map_err(err)?;
        }
        let legacy: String = tx
            .query_row(
                "SELECT id FROM chats ORDER BY created_at LIMIT 1",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        tx.execute(
            "UPDATE messages SET chat_id=?1 WHERE chat_id IS NULL",
            params![legacy],
        )
        .map_err(err)?;
        if !has_chat_id {
            tx.execute(
                "INSERT OR IGNORE INTO chat_drafts SELECT id,?1 FROM drafts",
                params![legacy],
            )
            .map_err(err)?;
        }
        tx.execute(
            "INSERT OR IGNORE INTO app_settings VALUES ('active_chat',?1)",
            params![legacy],
        )
        .map_err(err)?;
        // Preserve successful connections made before this setting existed.
        tx.execute("INSERT OR IGNORE INTO app_settings SELECT 'reddit_linked','true' WHERE EXISTS (SELECT 1 FROM activity WHERE message LIKE 'Connected to Reddit as %')",[]).map_err(err)?;
        tx.execute_batch(
            "CREATE INDEX IF NOT EXISTS messages_chat_id ON messages(chat_id,id);
            CREATE INDEX IF NOT EXISTS drafts_chat_id ON chat_drafts(chat_id);",
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }

    pub fn setting(&self, key: &str) -> Option<String> {
        self.0
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                params![key],
                |r| r.get(0),
            )
            .ok()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.0.execute("INSERT INTO app_settings VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(err)?;
        Ok(())
    }

    pub fn active_chat(&self) -> Result<String, String> {
        self.setting("active_chat").ok_or("No active chat.".into())
    }

    pub fn chats(&self) -> Result<Vec<ChatSession>, String> {
        let mut q=self.0.prepare("SELECT c.id,c.title,c.created_at,c.updated_at,
            (SELECT d.id FROM chat_drafts cd JOIN drafts d ON d.id=cd.draft_id WHERE cd.chat_id=c.id ORDER BY d.updated_at DESC LIMIT 1),
            (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id)
            FROM chats c ORDER BY c.updated_at DESC,c.rowid DESC").map_err(err)?;
        let rows = q
            .query_map([], |r| {
                Ok(ChatSession {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    created_at: r.get(2)?,
                    updated_at: r.get(3)?,
                    draft_id: r.get(4)?,
                    message_count: r.get(5)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    pub fn require_chat(&self, id: &str) -> Result<(), String> {
        self.0
            .query_row("SELECT id FROM chats WHERE id=?1", params![id], |r| {
                r.get::<_, String>(0)
            })
            .map(|_| ())
            .map_err(|_| "Chat no longer exists.".into())
    }

    pub fn new_chat(&self) -> Result<String, String> {
        let tx = self.0.unchecked_transaction().map_err(err)?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO chats VALUES (?1,'New chat',?2,?2)",
            params![id, now],
        )
        .map_err(err)?;
        self.set_setting("active_chat", &id)?;
        tx.commit().map_err(err)?;
        Ok(id)
    }

    pub fn switch_chat(&self, id: &str) -> Result<(), String> {
        self.require_chat(id)?;
        self.set_setting("active_chat", id)
    }

    pub fn require_draft_chat(&self, chat_id: &str, draft_id: &str) -> Result<(), String> {
        self.require_chat(chat_id)?;
        let owner: String = self
            .0
            .query_row(
                "SELECT chat_id FROM chat_drafts WHERE draft_id=?1",
                params![draft_id],
                |r| r.get(0),
            )
            .map_err(|_| "This draft does not belong to a chat.".to_string())?;
        if owner != chat_id {
            return Err("This draft belongs to a different chat.".into());
        }
        Ok(())
    }

    pub fn draft_chat(&self, draft_id: &str) -> Result<String, String> {
        self.0
            .query_row(
                "SELECT chat_id FROM chat_drafts WHERE draft_id=?1",
                params![draft_id],
                |r| r.get(0),
            )
            .map_err(|_| "Draft chat could not be found.".into())
    }

    pub fn save_for_chat(
        &self,
        chat_id: &str,
        id: Option<&str>,
        revision: Option<i64>,
        destination: &str,
        title: &str,
        body: &str,
    ) -> Result<Draft, String> {
        self.require_chat(chat_id)?;
        if let Some(id) = id {
            self.require_draft_chat(chat_id, id)?;
        }
        let tx = self.0.unchecked_transaction().map_err(err)?;
        let draft = self.save(id, revision, destination, title, body)?;
        self.0
            .execute(
                "INSERT OR IGNORE INTO chat_drafts VALUES (?1,?2)",
                params![draft.id, chat_id],
            )
            .map_err(err)?;
        self.0
            .execute(
                "UPDATE chats SET updated_at=?1 WHERE id=?2",
                params![Utc::now().to_rfc3339(), chat_id],
            )
            .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(draft)
    }

    pub fn drafts(&self) -> Result<Vec<Draft>, String> {
        let mut q = self.0.prepare("SELECT id,revision,destination,title,body,status,post_url,updated_at FROM drafts ORDER BY updated_at DESC").map_err(err)?;
        let rows = q
            .query_map([], |r| {
                Ok(Draft {
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    destination: r.get(2)?,
                    title: r.get(3)?,
                    body: r.get(4)?,
                    status: r.get(5)?,
                    post_url: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    pub fn get(&self, id: &str) -> Result<Draft, String> {
        self.drafts()?
            .into_iter()
            .find(|d| d.id == id)
            .ok_or("Draft no longer exists.".into())
    }

    pub fn save(
        &self,
        id: Option<&str>,
        revision: Option<i64>,
        destination: &str,
        title: &str,
        body: &str,
    ) -> Result<Draft, String> {
        validate_content(destination, title, body)?;
        let now = Utc::now().to_rfc3339();
        let id = if let Some(id) = id {
            let n = self.0.execute("UPDATE drafts SET revision=revision+1,destination=?1,title=?2,body=?3,status='draft',updated_at=?4 WHERE id=?5 AND revision=?6 AND status IN ('draft','waiting_login','blocked')", params![destination,title,body,now,id,revision]).map_err(err)?;
            if n != 1 {
                return Err(
                    "Draft changed or is already publishing. Reload before editing.".into(),
                );
            }
            id.to_owned()
        } else {
            let id = Uuid::new_v4().to_string();
            self.0
                .execute(
                    "INSERT INTO drafts VALUES (?1,1,?2,?3,?4,'draft',NULL,?5)",
                    params![id, destination, title, body, now],
                )
                .map_err(err)?;
            id
        };
        self.get(&id)
    }

    pub fn claim(&self, id: &str, revision: i64) -> Result<Draft, String> {
        let n = self.0.execute("UPDATE drafts SET status='running',updated_at=?1 WHERE id=?2 AND revision=?3 AND status IN ('draft','waiting_login','blocked')", params![Utc::now().to_rfc3339(),id,revision]).map_err(err)?;
        if n != 1 {
            return Err(
                "This draft changed or was already submitted. Confirm the current revision only."
                    .into(),
            );
        }
        self.get(id)
    }

    pub fn status(&self, id: &str, status: &str, url: Option<&str>) -> Result<Draft, String> {
        self.0
            .execute(
                "UPDATE drafts SET status=?1,post_url=?2,updated_at=?3 WHERE id=?4",
                params![status, url, Utc::now().to_rfc3339(), id],
            )
            .map_err(err)?;
        self.get(id)
    }

    pub fn log(&self, id: Option<&str>, message: &str) -> Result<(), String> {
        self.0
            .execute(
                "INSERT INTO activity (draft_id,message,created_at) VALUES (?1,?2,?3)",
                params![id, message, Utc::now().to_rfc3339()],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn activity(&self) -> Result<Vec<Activity>, String> {
        let mut q = self
            .0
            .prepare(
                "SELECT id,draft_id,message,created_at FROM activity ORDER BY id DESC LIMIT 150",
            )
            .map_err(err)?;
        let rows = q
            .query_map([], |r| {
                Ok(Activity {
                    id: r.get(0)?,
                    draft_id: r.get(1)?,
                    message: r.get(2)?,
                    created_at: r.get(3)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    pub fn messages(&self, chat_id: &str) -> Result<Vec<Message>, String> {
        self.require_chat(chat_id)?;
        let mut q = self
            .0
            .prepare("SELECT role,content FROM messages WHERE chat_id=?1 ORDER BY id")
            .map_err(err)?;
        let rows = q
            .query_map(params![chat_id], |r| {
                Ok(Message {
                    role: r.get(0)?,
                    content: r.get(1)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    pub fn message(&self, chat_id: &str, role: &str, content: &str) -> Result<(), String> {
        self.require_chat(chat_id)?;
        if role == "user" && self.messages(chat_id)?.is_empty() {
            let title = content
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(60)
                .collect::<String>();
            self.0
                .execute(
                    "UPDATE chats SET title=?1 WHERE id=?2",
                    params![title, chat_id],
                )
                .map_err(err)?;
        }
        self.0
            .execute(
                "INSERT INTO messages (role,content,chat_id) VALUES (?1,?2,?3)",
                params![role, content, chat_id],
            )
            .map_err(err)?;
        self.0
            .execute(
                "UPDATE chats SET updated_at=?1 WHERE id=?2",
                params![Utc::now().to_rfc3339(), chat_id],
            )
            .map_err(err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> Store {
        Store::open(Path::new(":memory:")).unwrap()
    }
    #[test]
    fn new_chats_isolate_messages_and_drafts_and_restore_history() {
        let db = store();
        let first = db.active_chat().unwrap();
        db.message(&first, "user", "My first idea").unwrap();
        db.message(&first, "assistant", "Here is a draft.").unwrap();
        let draft = db
            .save_for_chat(&first, None, None, "r/test", "First title", "")
            .unwrap();
        let second = db.new_chat().unwrap();
        assert_eq!(db.active_chat().unwrap(), second);
        assert!(db.messages(&second).unwrap().is_empty());
        assert!(db
            .chats()
            .unwrap()
            .iter()
            .find(|c| c.id == second)
            .unwrap()
            .draft_id
            .is_none());
        assert!(db
            .save_for_chat(
                &second,
                Some(&draft.id),
                Some(draft.revision),
                "r/test",
                "Wrong chat",
                ""
            )
            .is_err());
        assert_eq!(db.get(&draft.id).unwrap().title, "First title");
        db.switch_chat(&first).unwrap();
        assert_eq!(db.messages(&first).unwrap().len(), 2);
        let chat = db
            .chats()
            .unwrap()
            .into_iter()
            .find(|c| c.id == first)
            .unwrap();
        assert_eq!(chat.title, "My first idea");
        assert_eq!(chat.draft_id, Some(draft.id));
        assert!(db.switch_chat("missing").is_err());
        assert_eq!(db.active_chat().unwrap(), first);
    }

    #[test]
    fn legacy_migration_preserves_all_messages_drafts_and_connection_once() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE drafts (id TEXT PRIMARY KEY, revision INTEGER, destination TEXT, title TEXT, body TEXT, status TEXT,post_url TEXT,updated_at TEXT);
            CREATE TABLE messages (id INTEGER PRIMARY KEY,role TEXT,content TEXT);
            CREATE TABLE activity (id INTEGER PRIMARY KEY,draft_id TEXT,message TEXT,created_at TEXT);
            INSERT INTO drafts VALUES ('old-draft',1,'r/test','Saved title','','draft',NULL,'2026-10-27T00:00:00Z');
            INSERT INTO activity (message,created_at) VALUES ('Connected to Reddit as u/example.','2026-10-27T00:00:00Z');").unwrap();
        for i in 0..30 {
            connection
                .execute(
                    "INSERT INTO messages (role,content) VALUES ('user',?1)",
                    params![format!("Legacy message {i}")],
                )
                .unwrap();
        }
        let db = Store(connection);
        db.migrate_chats().unwrap();
        let first = db.active_chat().unwrap();
        assert_eq!(db.messages(&first).unwrap().len(), 30);
        assert_eq!(db.draft_chat("old-draft").unwrap(), first);
        assert_eq!(db.setting("reddit_linked").as_deref(), Some("true"));
        let new = db.new_chat().unwrap();
        db.migrate_chats().unwrap();
        assert_eq!(db.chats().unwrap().len(), 2);
        assert_eq!(db.messages(&first).unwrap().len(), 30);
        assert!(db.messages(&new).unwrap().is_empty());
        assert_eq!(db.active_chat().unwrap(), new);
    }

    #[test]
    fn selected_chat_and_browser_preference_survive_restart() {
        let path =
            std::env::temp_dir().join(format!("dinopost-history-{}.sqlite3", Uuid::new_v4()));
        let db = Store::open(&path).unwrap();
        let id = db.new_chat().unwrap();
        db.message(&id, "user", "Keep this conversation").unwrap();
        db.set_setting("reddit_linked", "true").unwrap();
        drop(db);
        let db = Store::open(&path).unwrap();
        assert_eq!(db.active_chat().unwrap(), id);
        assert_eq!(
            db.messages(&id).unwrap()[0].content,
            "Keep this conversation"
        );
        assert_eq!(db.setting("reddit_linked").as_deref(), Some("true"));
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn approval_is_single_use_and_bound_to_revision() {
        let db = store();
        let d = db.save(None, None, "r/test", "Hello", "").unwrap();
        let edited = db
            .save(Some(&d.id), Some(d.revision), "r/test", "Changed", "")
            .unwrap();
        assert!(db.claim(&d.id, d.revision).is_err());
        assert!(db.claim(&edited.id, edited.revision).is_ok());
        assert!(db.claim(&edited.id, edited.revision).is_err());
        assert!(db
            .save(Some(&d.id), Some(edited.revision), "r/test", "Race", "")
            .is_err());
    }
    #[test]
    fn uncertain_or_published_posts_cannot_be_retried() {
        let db = store();
        for status in ["submitting", "uncertain", "published"] {
            let d = db.save(None, None, "r/test", "Hello", "").unwrap();
            db.status(&d.id, status, None).unwrap();
            assert!(db.claim(&d.id, d.revision).is_err());
        }
    }
    #[test]
    fn manual_login_can_resume_without_a_new_draft() {
        let db = store();
        let d = db.save(None, None, "r/test", "Hello", "").unwrap();
        db.claim(&d.id, d.revision).unwrap();
        db.status(&d.id, "waiting_login", None).unwrap();
        assert!(db.claim(&d.id, d.revision).is_ok());
    }

    #[test]
    fn restart_recovers_in_flight_submit_without_allowing_a_duplicate() {
        let path = std::env::temp_dir().join(format!("dinopost-test-{}.sqlite3", Uuid::new_v4()));
        let db = Store::open(&path).unwrap();
        let draft = db.save(None, None, "r/test", "Hello", "").unwrap();
        db.claim(&draft.id, draft.revision).unwrap();
        db.status(&draft.id, "submitting", None).unwrap();
        drop(db);
        let recovered = Store::open(&path).unwrap();
        assert_eq!(recovered.get(&draft.id).unwrap().status, "uncertain");
        assert!(recovered.claim(&draft.id, draft.revision).is_err());
        drop(recovered);
        std::fs::remove_file(path).unwrap();
    }
}
