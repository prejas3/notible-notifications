/**
 * Runnable check for the parts of Notible Notifications that can be wrong
 * silently: manifest/plugin.json identity, the props round trip, and the
 * relative-time formatting.
 *
 * node plugins/notible-notifications/self-check.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import plugin, { NOTIFICATION_TYPE, parseNotification, relativeTime } from "./main.js";

// --- identity
const declared = JSON.parse(readFileSync(new URL("./plugin.json", import.meta.url), "utf8"));
assert.ok(plugin.manifest, "the entry module must export a manifest, not just onload");
for (const field of ["id", "name", "version", "apiVersion", "description", "author"]) {
  assert.equal(plugin.manifest[field], declared[field], `${field} must match plugin.json`);
}
assert.deepEqual(plugin.manifest.permissions, declared.permissions);
assert.equal(typeof plugin.onload, "function");
assert.equal(typeof plugin.onunload, "function");
assert.deepEqual([...declared.permissions].sort(), ["data.read", "data.write", "workspace.ui"]);
assert.ok(!declared.permissions.includes("notifications"), "the OS toast permission belongs to Automations, which calls context.notifications.show");
assert.ok(!declared.permissions.includes("network"), "notifications never leave the machine on their own");
assert.equal(NOTIFICATION_TYPE, "notification");

// --- parseNotification: a malformed or partial props blob must not throw
assert.deepEqual(
  parseNotification({ id: "1", title: "Task due", props: JSON.stringify({ body: "Ship it", read: false, at: 1000 }), created_at: "2026-01-01T00:00:00Z", updated_at: "x" }),
  { id: "1", title: "Task due", body: "Ship it", read: false, at: 1000, updatedAt: "x" },
);
assert.equal(parseNotification({ id: "2", title: "", props: "not json", created_at: "2026-01-01T00:00:00Z", updated_at: "x" }).title, "Notification", "an empty title falls back rather than rendering a blank row");
assert.equal(parseNotification({ id: "3", title: "T", props: "{}", created_at: "2026-01-01T00:00:00Z", updated_at: "x" }).read, false, "props missing `read` defaults to unread, never silently read");

// --- relativeTime
const now = Date.parse("2026-08-26T12:00:00Z");
assert.equal(relativeTime(now - 10_000, now), "just now");
assert.equal(relativeTime(now - 5 * 60_000, now), "5m ago");
assert.equal(relativeTime(now - 3 * 3600_000, now), "3h ago");
assert.equal(relativeTime(now - 2 * 86400_000, now), "2d ago");
assert.equal(relativeTime(now - 10 * 86400_000, now), new Date(now - 10 * 86400_000).toLocaleDateString());
assert.equal(relativeTime(now + 5000, now), "just now", "a clock-skewed future timestamp must not render a negative duration");

// --- no markup-assigning APIs: every string reaches the DOM through
// textContent, never through injected markup.
const source = readFileSync(new URL("./main.js", import.meta.url), "utf8");
for (const banned of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"]) {
  assert.ok(!source.includes(banned), `main.js must not use ${banned}`);
}

console.log("Notible Notifications self-check passed.");
