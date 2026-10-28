export function normalizeDestination(input) {
  const value = (input || "").trim().replace(/^\//, "");
  const match = /^(r|u)\/([a-zA-Z0-9_-]{1,21})$/.exec(value);
  if (!match) throw new Error("Nơi đăng phải là r/community hoặc u/username.");
  return `${match[1]}/${match[2]}`;
}

export function isRedditUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["www.reddit.com", "reddit.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function submitUrl(destination, hasMedia = false) {
  const [kind, name] = normalizeDestination(destination).split("/");
  const url = new URL(
    `https://www.reddit.com/${kind === "u" ? "user" : "r"}/${name}/submit`,
  );
  url.searchParams.set("type", hasMedia ? "IMAGE" : "TEXT");
  return url.href;
}

// Serialized by chrome.scripting.executeScript. Keep this function self-contained.
// This prepares a composer only; it never clicks Post or interacts with login/CAPTCHA.
export async function prepareRedditDraft(payload) {
  const { title, body, destination, media = [] } = payload;
  const result = (state, message) => ({ state, message });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const expected = /^(r|u)\/([a-zA-Z0-9_-]{1,21})$/.exec(destination || "");
  if (
    !expected ||
    typeof title !== "string" ||
    !title.trim() ||
    [...title].length > 300 ||
    /[\r\n]/.test(title) ||
    typeof body !== "string" ||
    body.length > 40000 ||
    media.length > 1
  )
    return result("blocked", "Bản nháp không hợp lệ.");
  if (
    location.protocol !== "https:" ||
    !["www.reddit.com", "reddit.com"].includes(location.hostname)
  ) {
    return result("blocked", "Chỉ chuẩn bị bài trên Reddit HTTPS.");
  }
  const scan = () => {
    const list = [];
    const visit = (root) => {
      for (const el of root.querySelectorAll("*")) {
        list.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(document);
    return list;
  };
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };
  const checkBarrier = () => {
    const text = (document.body?.innerText || "").slice(0, 20000).toLowerCase();
    const elements = scan();
    if (
      elements.some(
        (el) =>
          visible(el) &&
          el.matches(
            'iframe[src*="captcha"], iframe[src*="challenge"], [data-testid="captcha"]',
          ),
      ) ||
      /prove your humanity|verify you are human|complete the captcha|xác minh bạn là con người/.test(
        text,
      )
    ) {
      return result(
        "waiting_verification",
        "Hãy hoàn thành CAPTCHA / xác minh trong Chrome, rồi bấm Tiếp tục.",
      );
    }
    if (
      /\/login(?:\/|$)/.test(location.pathname) ||
      elements.some((el) => visible(el) && el.matches('input[type="password"]'))
    ) {
      return result(
        "waiting_login",
        "Hãy đăng nhập Reddit thủ công trong Chrome, rồi bấm Tiếp tục.",
      );
    }
    if (
      /you.ve been blocked|blocked by network security|too many requests|try again later/.test(
        text,
      )
    ) {
      return result(
        "blocked",
        "Reddit đang chặn hoặc giới hạn truy cập. Bản nháp được giữ lại.",
      );
    }
    return null;
  };
  const barrier = checkBarrier();
  if (barrier) return barrier;
  const route = /^\/(r|user)\/([^/]+)\/submit\/?$/.exec(location.pathname);
  if (
    !route ||
    (route[1] === "user" ? "u" : "r") !== expected[1] ||
    route[2].toLowerCase() !== expected[2].toLowerCase()
  ) {
    return result("blocked", "Trang soạn bài không khớp nơi đăng đã duyệt.");
  }
  let elements = scan();
  const picker = elements.filter(
    (el) =>
      visible(el) &&
      el.matches(
        'button, select, [role="combobox"], [data-testid="subreddit-picker"]',
      ),
  );
  const selected = picker
    .map((el) =>
      (el.tagName === "SELECT"
        ? el.selectedOptions?.[0]?.textContent
        : el.getAttribute("aria-label") || el.innerText || el.textContent || ""
      ).trim(),
    )
    .map((text) => text.match(/^(r|u)\/[A-Za-z0-9_-]{1,21}(?=\s|$)/i)?.[0])
    .filter(Boolean);
  if (
    !selected.length ||
    selected.some((text) => text.toLowerCase() !== destination.toLowerCase())
  ) {
    return result(
      "blocked",
      "Không xác minh được nơi đăng trong bộ chọn cộng đồng. Hãy chọn đúng nơi đăng trước.",
    );
  }
  const ancestorExcluded = (el) => {
    for (
      let node = el;
      node;
      node = node.parentElement || node.getRootNode()?.host
    ) {
      if (
        node.matches?.(
          'header, nav, [role="search"], [role="navigation"], shreddit-user-drawer',
        )
      )
        return true;
    }
    return false;
  };
  const editors = () =>
    scan().filter((el) => visible(el) && !ancestorExcluded(el));
  const attachMedia = async (bodyEditor) => {
    if (!media.length) return null;
    const item = media[0];
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        item.type,
      ) ||
      typeof item.base64 !== "string" ||
      !item.base64.startsWith(`data:${item.type};base64,`) ||
      item.base64.length > 5700000
    ) {
      return result(
        "blocked",
        "Chỉ hỗ trợ một ảnh hợp lệ tối đa 4 MiB trong phiên thử nghiệm.",
      );
    }
    let inputs = scan().filter(
      (el) =>
        el.matches('input[type="file"]') &&
        !ancestorExcluded(el) &&
        (!el.accept ||
          /image|\.png|\.jpg|\.jpeg|\.webp|\.gif/i.test(el.accept)),
    );
    if (inputs.length !== 1 && !bodyEditor?.isContentEditable)
      return result(
        "blocked",
        "Không xác định được bộ tải ảnh hoặc trình soạn thảo hỗ trợ ảnh. Hãy đính kèm ảnh thủ công trong Reddit.",
      );
    // Multiple hidden upload inputs are normal in Reddit's rich-text toolbar.
    // Use the verified editor's single paste path rather than choosing among them.
    const input = inputs.length === 1 ? inputs[0] : null;
    // Retrying a human-verification pause must not append the same image again.
    if (input?.files.length || bodyEditor?.querySelector("img"))
      return result(
        "blocked",
        "Form đã có tệp. Kiểm tra trực tiếp trong Reddit trước khi điền lại.",
      );
    const bytes = Uint8Array.from(atob(item.base64.split(",")[1]), (char) =>
      char.charCodeAt(0),
    );
    if (item.sha256) {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const actual = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      if (actual !== item.sha256)
        return result("blocked", "Ảnh đính kèm đã thay đổi so với bản nháp.");
    }
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: item.type }),
    ).catch(() => null);
    if (!bitmap) return result("blocked", "Không đọc được ảnh đính kèm.");
    bitmap.close();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], item.name, { type: item.type }));
    if (input) {
      input.files = transfer.files;
      input.dispatchEvent(
        new Event("change", { bubbles: true, composed: true }),
      );
      await sleep(300);
    } else {
      // Current Reddit can expose an inline Lexical image toolbar instead of a media tab.
      // Send exactly one file paste after inserting the caption, never three upload paths.
      bodyEditor.focus();
      const selection =
        bodyEditor.getRootNode().getSelection?.() || window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(bodyEditor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      const before = new Set(
        scan()
          .filter((el) => el.matches("img"))
          .map((el) => el.currentSrc || el.src),
      );
      bodyEditor.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
      let imageVisible = false;
      for (let wait = 0; wait < 50; wait++) {
        await sleep(100);
        const barrier = checkBarrier();
        if (barrier) return barrier;
        imageVisible = scan().some(
          (el) =>
            el.matches("img") &&
            visible(el) &&
            !before.has(el.currentSrc || el.src) &&
            /^(blob:|https:\/\/[^/]*(?:redd\.it|redditmedia\.com)\/)/.test(
              el.currentSrc || el.src,
            ),
        );
        if (imageVisible) break;
      }
      if (!imageVisible)
        return result(
          "blocked",
          "Reddit chưa xác nhận ảnh đính kèm. Kiểm tra trình soạn thảo và tải ảnh thủ công; không tự động thử lại.",
        );
    }
    const blocked = checkBarrier();
    if (blocked) return blocked;
    return null;
  };
  elements = editors();
  const labels = (el) =>
    [
      el.getAttribute("name"),
      el.getAttribute("placeholder"),
      el.getAttribute("aria-label"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  const titleInputs = elements.filter(
    (el) =>
      el.matches('textarea, input[type="text"], input:not([type])') &&
      /title|tiêu đề/.test(labels(el)),
  );
  if (titleInputs.length !== 1)
    return result("blocked", "Không xác định được đúng một ô Tiêu đề.");
  const setText = (el, value) => {
    el.focus();
    const prototype =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  };
  setText(titleInputs[0], title);
  const bodyInputs = elements.filter(
    (el) =>
      el !== titleInputs[0] &&
      el.matches('textarea, [contenteditable="true"]') &&
      (/body|text|nội dung|văn bản/.test(labels(el)) ||
        el.hasAttribute("data-lexical-editor")),
  );
  if (bodyInputs.length > 1 || (body && !bodyInputs.length))
    return result(
      "blocked",
      "Không xác định được ô nội dung. Hãy điền nội dung thủ công.",
    );
  if (media.length && bodyInputs[0]?.querySelector("img"))
    return result(
      "blocked",
      "Trình soạn thảo đã có ảnh. Kiểm tra Reddit trước khi điền lại.",
    );
  if (bodyInputs[0]) {
    const el = bodyInputs[0];
    if (el.tagName === "TEXTAREA") setText(el, body);
    else {
      el.focus();
      const selection =
        el.getRootNode().getSelection?.() || window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      // Let Lexical observe the native selection before replacing it. Its paste
      // handler preserves paragraphs; insertText can flatten multi-line captions.
      await sleep(50);
      if (body) {
        const text = new DataTransfer();
        text.setData("text/plain", body);
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: text,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      } else document.execCommand("delete");
    }
    await sleep(100);
    const actual = el.tagName === "TEXTAREA" ? el.value : el.innerText;
    // Rich text renders empty paragraphs with extra newlines/NBSP. Compare all
    // caption characters and line order without depending on that DOM spacing.
    const normalizeCaption = (text) =>
      text
        .replace(/\r\n/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n+/g, "\n")
        .trim();
    if (normalizeCaption(actual) !== normalizeCaption(body))
      return result(
        "blocked",
        "Nội dung trong Reddit chưa khớp bản nháp. Hãy kiểm tra thủ công.",
      );
  }
  if (titleInputs[0].value !== title)
    return result("blocked", "Tiêu đề trong Reddit chưa khớp bản nháp.");
  const attachmentResult = await attachMedia(bodyInputs[0]);
  if (attachmentResult) return attachmentResult;
  const finalBarrier = checkBarrier();
  if (finalBarrier) return finalBarrier;
  return result(
    "prepared",
    "Đã chuẩn bị form. Kiểm tra nơi đăng, tiêu đề, nội dung và ảnh / tiến trình tải trong Reddit, rồi tự bấm Post. Chưa xuất bản bài.",
  );
}
