(a) => {
  const s = window.__dinopost;
  if (
    location.origin !== "https://www.reddit.com" ||
    !s ||
    s.token !== a.token ||
    s.url !== location.href
  )
    return null;
  const n = s.nodes.get(a.id),
    e = n?.el;
  if (
    !e?.isConnected ||
    s.name(e) !== a.label ||
    (a.editable && s.value(e) !== a.value) ||
    e.disabled ||
    e.getAttribute("aria-disabled") === "true"
  )
    return null;
  if (a.approved) {
    const d = a.approved,
      dest = d.destination.replace(/^u\//, "user/");
    if (location.pathname.replace(/\/$/, "") !== "/" + dest + "/submit")
      return null;
    const destinations = s.destinations();
    if (
      destinations.length !== 1 ||
      destinations[0].toLowerCase() !== d.destination.toLowerCase()
    )
      return null;
    const live = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.matches('input[type="file"]') && el.files?.length > 0)
          live.push(el);
        if (
          el.matches('input,textarea,[contenteditable="true"]') &&
          s.visible(el)
        )
          live.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    if (
      live.some(
        (el) => el.matches('input[type="file"]') && el.files?.length > 0,
      )
    )
      return null;
    const title = live.find((el) => s.name(el).toLowerCase().includes("title"));
    const body = live.find(
      (el) =>
        el !== title &&
        el.matches('textarea,[contenteditable="true"]') &&
        !s.name(el).toLowerCase().includes("search"),
    );
    if (
      !title ||
      s.value(title) !== d.title ||
      (body ? s.value(body) !== d.body.trim() : d.body !== "")
    )
      return null;
  }
  e.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = e.getBoundingClientRect(),
    x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const deep = hit.shadowRoot.elementFromPoint(x, y);
    if (!deep || deep === hit) break;
    hit = deep;
  }
  let p = hit,
    ok = false;
  while (p) {
    if (p === e) {
      ok = true;
      break;
    }
    p = p.parentElement || p.getRootNode()?.host;
  }
  return ok && s.visible(e) ? { x, y } : null;
};
