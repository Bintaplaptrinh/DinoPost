use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub revision: i64,
    pub destination: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub post_url: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub draft_id: Option<String>,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: i64,
    pub draft_id: Option<String>,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub status: String,
    pub username: Option<String>,
    pub message: String,
}

pub fn validate_content(destination: &str, title: &str, body: &str) -> Result<(), String> {
    let (kind, name) = destination
        .split_once('/')
        .ok_or("Use r/community or u/username.")?;
    if !["r", "u"].contains(&kind)
        || !(3..=21).contains(&name.len())
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || (kind == "u" && c == b'-'))
    {
        return Err("Use a valid r/community or u/username destination.".into());
    }
    if title.trim().is_empty() || title.chars().count() > 300 {
        return Err("A Reddit title must contain 1–300 characters.".into());
    }
    if body.chars().count() > 40_000 {
        return Err("The post body must be 40,000 characters or fewer.".into());
    }
    Ok(())
}

pub fn is_reddit_url(value: &str) -> bool {
    reqwest::Url::parse(value)
        .is_ok_and(|url| url.scheme() == "https" && url.host_str() == Some("www.reddit.com"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_destinations_that_can_escape_reddit() {
        for bad in [
            "r/test/../admin",
            "https://evil.test",
            "r/a?next=evil",
            "r/a",
            "r/test\n",
        ] {
            assert!(validate_content(bad, "Hello", "").is_err());
        }
        assert!(validate_content("r/test", "Today is the great day", "").is_ok());
        assert!(validate_content("u/some-user", "Hello", "").is_ok());
    }
    #[test]
    fn checks_origin_not_a_substring() {
        assert!(is_reddit_url("https://www.reddit.com/r/test/submit"));
        assert!(!is_reddit_url("https://www.reddit.com.evil.test/"));
        assert!(!is_reddit_url("http://www.reddit.com/"));
    }
}
