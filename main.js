/**
 * Notible Notifications — the in-app trail behind Automations' "notify"
 * action.
 *
 * One ES module, no build step, no dependencies, no network. Automations
 * already fires a native OS toast for that action (API 1.10's
 * `context.notifications.show`) and, alongside it, writes a plain workspace
 * object of type "notification" — see `executeAutomationRule` in
 * plugins/builtin/automations.ts. A toast is fire-and-forget: miss it and it
 * is gone, and there is no way to ask the OS what it showed an hour ago. This
 * plugin only reads that trail back and draws it as a bell with an unread
 * count, the same relationship notible.habits has to a `habit` object — the
 * object is the source of truth, this is a view onto it.
 *
 * The pure functions below are exported by name so `self-check.mjs` can run
 * them under plain node; the plugin itself is the default export.
 */

export const NOTIFICATION_TYPE = "notification";

/** A workspace kept for years should not carry an unbounded notification
 * log. `load()` trims back to this on every open — the newest ones are what
 * anyone is looking for, and Automations' own execution log already keeps
 * the durable history of what a rule did.
 * ponytail: one flat cap, raised if a real workspace shows it is wrong. */
const MAX_STORED = 200;

export function parseNotification(object) {
  let body = "";
  let read = false;
  let at = Date.parse(object.created_at ?? "") || Date.now();
  try {
    const props = JSON.parse(object.props || "{}");
    if (typeof props.body === "string") body = props.body;
    if (typeof props.read === "boolean") read = props.read;
    if (typeof props.at === "number") at = props.at;
  } catch { /* a malformed props blob reads as an unread, bodyless entry */ }
  return { id: object.id, title: object.title || "Notification", body, read, at, updatedAt: object.updated_at };
}

function serializeNotification(entry) {
  return JSON.stringify({ body: entry.body, read: entry.read, at: entry.at });
}

/** "just now" / "5m ago" / "3h ago" / "2d ago", then a plain date — the same
 * granularity a chat client uses, because past a couple of days the exact
 * hour stops mattering and the day does. */
export function relativeTime(atMs, nowMs = Date.now()) {
  const diff = Math.max(0, nowMs - atMs);
  const minute = 60000;
  const hour = 3600000;
  const day = 86400000;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(atMs).toLocaleDateString();
}

function element(tag, properties = {}, children = []) {
  const node = Object.assign(document.createElement(tag), properties);
  for (const child of children) node.append(child);
  return node;
}

/** Every string drawn below reaches the DOM through `textContent`, never
 * through markup composed from a string — same rule and same
 * `self-check.mjs` grep as notible.habits. */
function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

class NotificationCenter {
  constructor(context) {
    this.context = context;
    this.entries = [];
    this.listeners = new Set();
    this.loading = true;
    this.error = "";
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener();
  }

  async load() {
    try {
      const objects = await this.context.data.objects.query({ type: NOTIFICATION_TYPE, limit: MAX_STORED + 50 });
      const entries = objects.map(parseNotification).sort((a, b) => b.at - a.at);
      const overflow = entries.slice(MAX_STORED);
      if (overflow.length > 0) {
        await Promise.all(overflow.map((entry) => this.context.data.objects.trash(entry.id).catch(() => {})));
      }
      this.entries = entries.slice(0, MAX_STORED);
      this.loading = false;
      this.error = "";
    } catch (cause) {
      this.loading = false;
      this.error = cause instanceof Error ? cause.message : String(cause);
    }
    this.emit();
  }

  get unreadCount() {
    return this.entries.filter((entry) => !entry.read).length;
  }

  async markRead(entry) {
    if (entry.read) return;
    entry.read = true;
    this.emit();
    await this.context.data.objects.update(entry.id, { props: serializeNotification(entry) }).catch(() => { entry.read = false; this.emit(); });
  }

  async markAllRead() {
    const unread = this.entries.filter((entry) => !entry.read);
    if (unread.length === 0) return;
    for (const entry of unread) entry.read = true;
    this.emit();
    await Promise.all(unread.map((entry) => this.context.data.objects.update(entry.id, { props: serializeNotification(entry) }).catch(() => {})));
  }

  async clearAll() {
    const all = this.entries;
    this.entries = [];
    this.emit();
    await Promise.all(all.map((entry) => this.context.data.objects.trash(entry.id).catch(() => {})));
  }
}

function row(center, entry) {
  const item = element("li", { className: "nnot-row" });
  item.dataset.read = entry.read ? "yes" : "no";
  item.addEventListener("click", () => void center.markRead(entry));
  item.append(element("span", { className: "nnot-dot" }));
  const body = element("div", { className: "nnot-body" }, [
    text("strong", entry.title, "nnot-title"),
  ]);
  if (entry.body) body.append(text("p", entry.body, "nnot-text"));
  body.append(text("small", relativeTime(entry.at), "nnot-time"));
  item.append(body);
  return item;
}

function mountBell(center, container) {
  const root = element("div", { className: "nnot" });
  root.append(element("style", { textContent: styles }));
  const button = element("button", { type: "button", className: "nnot-bell", title: "Notifications", "aria-label": "Notifications" });
  button.append(bellIcon());
  const badge = text("span", "", "nnot-badge");
  button.append(badge);
  root.append(button);

  // The bell sits in the sidebar, and `.core-sidebar` clips its own overflow
  // (it has to, for the note tree's internal scrollbar to work) — a panel
  // positioned relative to `root` was clipped to the sidebar's own width the
  // instant it grew past it. Appending to `document.body` and positioning
  // `fixed` from the bell's own rect, the same escape notible.habits' row
  // menu already uses, puts it above everything instead of inside the
  // sidebar's clip.
  const panel = element("div", { className: "nnot-panel" });
  panel.append(element("style", { textContent: styles }));
  document.body.append(panel);

  let open = false;
  const closePanel = () => {
    open = false;
    panel.classList.remove("is-open");
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", position);
  };
  const position = () => {
    const rect = button.getBoundingClientRect();
    panel.style.left = `${Math.round(rect.left)}px`;
    panel.style.top = `${Math.round(rect.bottom + 6)}px`;
  };
  const onOutside = (event) => { if (!root.contains(event.target) && !panel.contains(event.target)) closePanel(); };
  const onKey = (event) => { if (event.key === "Escape") closePanel(); };
  button.addEventListener("click", () => {
    open = !open;
    panel.classList.toggle("is-open", open);
    if (open) {
      position();
      window.addEventListener("resize", position);
      setTimeout(() => {
        document.addEventListener("mousedown", onOutside, true);
        document.addEventListener("keydown", onKey, true);
      }, 0);
    }
  });

  const render = () => {
    badge.textContent = center.unreadCount > 0 ? String(Math.min(center.unreadCount, 99)) : "";
    badge.classList.toggle("is-visible", center.unreadCount > 0);
    panel.replaceChildren();
    panel.append(element("div", { className: "nnot-head" }, [
      text("span", "Notifications"),
      element("button", { type: "button", className: "nnot-link", textContent: "Clear", onclick: () => void center.clearAll() }),
    ]));
    if (center.loading) {
      panel.append(text("p", "Loading…", "nnot-empty"));
      return;
    }
    if (center.error) {
      panel.append(text("p", center.error, "nnot-empty"));
      return;
    }
    if (center.entries.length === 0) {
      panel.append(text("p", "Nothing yet. An automation's “notify” action lands here.", "nnot-empty"));
      return;
    }
    const list = element("ul", { className: "nnot-list" });
    for (const entry of center.entries) list.append(row(center, entry));
    panel.append(list);
  };

  const stop = center.onChange(render);
  render();
  container.append(root);
  return { dispose: () => { stop(); closePanel(); root.remove(); panel.remove(); } };
}

/** A single outline glyph, drawn in `currentColor` so it follows the same
 * icon color as every other sidebar control without a colour literal of its
 * own (`plugin-css-token-check.mjs` would fail one). */
function bellIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "17");
  svg.setAttribute("height", "17");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9");
  const clapper = document.createElementNS("http://www.w3.org/2000/svg", "path");
  clapper.setAttribute("d", "M13.73 21a2 2 0 0 1-3.46 0");
  svg.append(path, clapper);
  return svg;
}

const styles = `
/* Left-aligned with a 4px inset so the 36px bell sits exactly above the 36px
   "+" button: the ribbon slot is a direct child of .core-sidebar (12px pad),
   while .core-sidebar-actions adds another 4px before the + button. */
.nnot { position: relative; display: flex; width: 100%; padding-left: 4px; }
/* Filled bordo, matching Core's own chrome icon-buttons (Back / + / search),
   which were deliberately filled rather than outlined. */
.nnot-bell { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex: 0 0 36px; border: 1px solid var(--notible-accent); border-radius: 9px; background: var(--notible-accent); color: var(--notible-on-accent); cursor: pointer; }
.nnot-bell:hover { background: var(--notible-accent-hover); border-color: var(--notible-accent-hover); color: var(--notible-on-accent); }
.nnot-badge { position: absolute; top: 2px; right: 2px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 999px; background: var(--notible-surface); color: var(--notible-accent); font-size: 10px; line-height: 14px; text-align: center; display: none; }
.nnot-badge.is-visible { display: block; }
.nnot-panel { display: none; position: fixed; z-index: 1000; width: 300px; max-height: 360px; overflow-y: auto; border: 1px solid var(--notible-border); border-radius: 10px; background: var(--notible-surface); box-shadow: 0 10px 28px rgba(0, 0, 0, .16); }
.nnot-panel.is-open { display: block; }
.nnot-head { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid var(--notible-border-subtle); background: var(--notible-surface); font-size: 12px; font-weight: 600; color: var(--notible-muted); text-transform: uppercase; letter-spacing: .04em; }
.nnot-link { border: 0; background: none; padding: 0; color: var(--notible-accent); font: inherit; font-size: 11px; text-transform: none; letter-spacing: 0; cursor: pointer; }
.nnot-link:hover { text-decoration: underline; }
.nnot-empty { margin: 0; padding: 16px 12px; color: var(--notible-muted); font-size: 12px; line-height: 1.5; }
.nnot-list { list-style: none; margin: 0; padding: 4px; display: grid; gap: 2px; }
.nnot-row { display: flex; align-items: flex-start; gap: 8px; border-radius: 7px; padding: 7px 8px; cursor: pointer; }
.nnot-row:hover { background: var(--notible-hover); }
.nnot-dot { flex: none; width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; background: var(--notible-accent); }
.nnot-row[data-read="yes"] .nnot-dot { background: transparent; }
.nnot-body { min-width: 0; display: grid; gap: 2px; }
.nnot-title { font-size: 12.5px; color: var(--notible-text); }
.nnot-row[data-read="yes"] .nnot-title { color: var(--notible-muted); font-weight: 400; }
.nnot-text { margin: 0; color: var(--notible-muted); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.nnot-time { color: var(--notible-faint); font-size: 11px; }
`;

export default {
  // Core reads `plugin.json` first and refuses an entry module that claims a
  // different identity — `self-check.mjs` asserts the two stay in step.
  manifest: {
    id: "notible.notifications",
    name: "Notible Notifications",
    version: "0.1.4",
    apiVersion: "1.10",
    description: "An in-app trail for what Automations already fires as an OS toast. A toast is gone the moment it is missed; this keeps a short, readable log behind a bell icon in the sidebar, with an unread count and a one-click clear.",
    author: "Notible",
    permissions: ["data.read", "data.write", "workspace.ui"],
  },

  onload(context) {
    const center = new NotificationCenter(context);
    this._center = center;
    this._disposables = [];

    // Named so a notification gets a bell icon of its own if it is ever
    // opened directly (search, export) instead of showing as an unknown
    // type. Failing this must not take the plugin down with it.
    void context.data.types.upsert(NOTIFICATION_TYPE, JSON.stringify({ fields: [] }), "bell").catch(() => {});
    void center.load();

    this._disposables.push(context.ui.registerSlot("workspace.ribbon", {
      id: "bell",
      mount: ({ container }) => mountBell(center, container),
    }));

    // Automations writes the object directly (see automations.ts); this
    // plugin only ever reloads in response, the same as habits reloading off
    // `object.*` for its own type.
    for (const event of ["object.created", "object.updated", "object.trashed"]) {
      this._disposables.push(context.events.on(event, (payload) => {
        if (payload?.type === NOTIFICATION_TYPE) void center.load();
      }));
    }
  },

  onunload() {
    for (const disposable of this._disposables ?? []) disposable.dispose?.();
    this._disposables = [];
    this._center = null;
  },
};
