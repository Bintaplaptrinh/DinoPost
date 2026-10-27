(() => {
  if (location.origin !== "https://www.reddit.com")
    throw new Error("Reddit origin required");
  const all = [];
  function visit(root) {
    for (const el of root.querySelectorAll("*")) {
      all.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  }
  visit(document);
  const visible = (el) => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== "hidden" &&
      s.display !== "none"
    );
  };
  const name = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.labels?.[0]?.innerText ||
      el.getAttribute("name") ||
      el.innerText ||
      el.textContent ||
      ""
    )
      .trim()
      .slice(0, 180);
  const value = (el) =>
    el.isContentEditable ? el.innerText.trim() : (el.value ?? "");
  // Reddit renders the visible Post text inside nested Lit spans, often in
  // an open shadow root. Resolve the owning control rather than clicking a
  // span (or relying on Lit's generated comment identifiers).
  const isPostSubmit = (el) => {
    if (!el.matches('button,[role="button"]')) return false;
    if (el.id === "inner-post-submit-button") return true;
    const label = name(el).replace(/\s+/g, " ").toLowerCase();
    if (["post", "submit post", "publish"].includes(label)) return true;
    return [...el.querySelectorAll("span")].some(
      (span) => span.textContent.trim() === "Post",
    );
  };
  const destinations = () => [
    ...new Set(
      all
        .filter(
          (el) =>
            el.isConnected &&
            visible(el) &&
            el.matches('button,[role="combobox"],select'),
        )
        .flatMap((el) => {
          const label =
            (el.tagName === "SELECT"
              ? el.selectedOptions?.[0]?.textContent
              : name(el)) || "";
          const match = label
            .trim()
            .match(/^(r|u)\/[A-Za-z0-9_-]{3,21}(?=\s|$)/);
          return match ? [match[0]] : [];
        }),
    ),
  ];
  const elements = all
    .filter(
      (el) =>
        visible(el) &&
        el.matches(
          'input:not([type="hidden"]),textarea,button,[role="button"],[role="tab"],[contenteditable="true"],a[href]',
        ),
    )
    .filter((el) => !el.disabled && el.getAttribute("aria-disabled") !== "true")
    .slice(0, 160);
  const token = crypto.randomUUID();
  const nodes = new Map();
  const controls = elements.map((el, i) => {
    const id = String(i + 1);
    const label = name(el);
    const editable = el.matches('input,textarea,[contenteditable="true"]');
    nodes.set(id, { el, label, value: value(el) });
    return {
      id,
      label,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      type: el.getAttribute("type"),
      editable,
      value: editable ? value(el).slice(0, 40000) : "",
      href: el.href || "",
      selected: el.getAttribute("aria-selected") === "true",
      postSubmit: isPostSubmit(el),
    };
  });
  window.__dinopost = {
    token,
    url: location.href,
    nodes,
    name,
    value,
    visible,
    destinations,
  };
  const text = (document.body?.innerText || "").slice(0, 6500);
  const titles = all
    .filter((el) => el.matches("h1"))
    .map((el) => el.textContent.trim());
  const posts = all
    .filter((el) => el.matches("shreddit-post,article"))
    .map((el) => el.textContent.trim())
    .slice(0, 3);
  return {
    token,
    url: location.href,
    title: document.title,
    text,
    controls,
    titles,
    posts,
    destinations: destinations(),
    postButtonDisabled: all.some(
      (el) =>
        visible(el) &&
        isPostSubmit(el) &&
        (el.disabled || el.getAttribute("aria-disabled") === "true"),
    ),
    attachedFiles: all.some(
      (el) => el.matches('input[type="file"]') && el.files?.length > 0,
    ),
    blocked:
      /you.ve been blocked by network security|whoa there, pardner|your account has been suspended|verify you are human|prove your humanity|complete the challenge|complete the captcha/i.test(
        text,
      ),
  };
})();
