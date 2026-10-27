use crate::domain::Draft;
use serde_json::Value;

pub struct Composer<'a> {
    pub title: Option<&'a Value>,
    pub body: Option<&'a Value>,
    pub title_ready: bool,
    pub body_ready: bool,
    pub destination_ready: bool,
    pub post_button: Option<&'a Value>,
}

impl<'a> Composer<'a> {
    pub fn read(page: &'a Value, draft: &Draft) -> Result<Self, String> {
        let controls = page["controls"]
            .as_array()
            .ok_or("Could not read the Reddit composer.")?;
        let title = controls.iter().find(|c| {
            c["editable"] == true
                && c["label"]
                    .as_str()
                    .is_some_and(|s| s.to_lowercase().contains("title"))
        });
        let body = controls.iter().find(|c| {
            c["editable"] == true
                && Some(*c) != title
                && (c["tag"] == "textarea" || c["tag"] == "div" || c["role"] == "textbox")
                && !c["label"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains("search")
        });
        let title_ready = title.is_some_and(|c| c["value"].as_str() == Some(draft.title.as_str()));
        let body_ready = body
            .map(|c| c["value"].as_str() == Some(draft.body.trim()))
            .unwrap_or(draft.body.is_empty());
        let destination_ready = page["destinations"].as_array().is_some_and(|values| {
            values.len() == 1
                && values[0]
                    .as_str()
                    .is_some_and(|v| v.eq_ignore_ascii_case(&draft.destination))
        });
        let mut buttons = controls.iter().filter(|c| {
            c["postSubmit"] == true
                && c["editable"] != true
                && (c["tag"] == "button" || c["role"] == "button")
        });
        let candidate = buttons.next();
        let post_button = if title_ready
            && body_ready
            && destination_ready
            && page["attachedFiles"] != true
            && page["blocked"] != true
            && buttons.next().is_none()
        {
            candidate
        } else {
            None
        };
        Ok(Self {
            title,
            body,
            title_ready,
            body_ready,
            destination_ready,
            post_button,
        })
    }

    pub fn blocked_reason(&self, page: &Value) -> String {
        if !self.title_ready {
            return "Reddit's title field does not match the approved draft. Check the title in Chrome.".into();
        }
        if !self.body_ready {
            return "Reddit's body field does not match the approved draft. Check the body in Chrome.".into();
        }
        if !self.destination_ready {
            return "The visible Reddit destination does not match the approved draft. Check the community picker in Chrome.".into();
        }
        if page["postButtonDisabled"] == true {
            return "Reddit's Post button is disabled. Check Chrome for required fields, flair, or community restrictions.".into();
        }
        "An enabled, unambiguous Reddit Post button was not found. Check the composer in Chrome."
            .into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn draft() -> Draft {
        Draft {
            id: "test".into(),
            revision: 1,
            destination: "r/test".into(),
            title: "Today is the great day".into(),
            body: "".into(),
            status: "running".into(),
            post_url: None,
            updated_at: String::new(),
        }
    }
    fn composer() -> Value {
        json!({"controls":[
            {"id":"search","tag":"textarea","editable":true,"label":"Search in r/test","value":""},
            {"id":"title","tag":"textarea","editable":true,"label":"Title","value":"Today is the great day"},
            {"id":"body","tag":"div","role":"textbox","editable":true,"label":"Post body text field","value":""},
            {"id":"post","tag":"button","editable":false,"label":"Post","postSubmit":true}
        ],"destinations":["r/test"],"attachedFiles":false,"blocked":false})
    }
    #[test]
    fn finds_post_only_for_the_exact_approved_composer() {
        let page = composer();
        let d = draft();
        assert_eq!(
            Composer::read(&page, &d).unwrap().post_button.unwrap()["id"],
            "post"
        );
        for (field, value) in [
            ("destinations", json!(["r/other"])),
            ("attachedFiles", json!(true)),
            ("blocked", json!(true)),
        ] {
            let mut changed = page.clone();
            changed[field] = value;
            assert!(Composer::read(&changed, &d).unwrap().post_button.is_none());
        }
        let mut changed = page.clone();
        changed["controls"][1]["value"] = json!("Unapproved title");
        assert!(Composer::read(&changed, &d).unwrap().post_button.is_none());
        let mut changed = page.clone();
        changed["controls"][2]["value"] = json!("Unapproved body");
        assert!(Composer::read(&changed, &d).unwrap().post_button.is_none());
    }
    #[test]
    fn disabled_missing_or_ambiguous_post_controls_do_not_submit() {
        let mut page = composer();
        let d = draft();
        let button = page["controls"].as_array_mut().unwrap().pop().unwrap();
        page["postButtonDisabled"] = json!(true);
        let inspected = Composer::read(&page, &d).unwrap();
        assert!(inspected.post_button.is_none());
        assert!(inspected.blocked_reason(&page).contains("disabled"));
        page["controls"]
            .as_array_mut()
            .unwrap()
            .extend([button.clone(), button]);
        assert!(Composer::read(&page, &d).unwrap().post_button.is_none());
    }
}
