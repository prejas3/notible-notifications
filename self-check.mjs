/**
 * Runnable check for the parts of Notible Notifications that can be wrong
 * silently: manifest/plugin.json identity, the props round trip, and the
 * relative-time formatting.
 *
 * node plugins/notible-notifications/self-check.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import plugin, { NOTIFICATION_TYPE, REMINDER_TYPE, parseNotification, parseReminder, dueLabel, relativeTime } from "./main.js";

// --- identity
const declared = JSON.parse(readFileSync(new URL("./plugin.json", import.meta.url), "utf8"));
assert.ok(plugin.manifest, "the entry module must export a manifest, not just onload");
for (const field of ["id", "name", "version", "apiVersion", "description", "author"]) {
  assert.equal(plugin.manifest[field], declared[field], `${field} must match plugin.json`);
}
assert.deepEqual(plugin.manifest.permissions, declared.permissions);
assert.equal(typeof plugin.onload, "function");
assert.equal(typeof plugin.onunload, "function");
assert.deepEqual([...declared.permissions].sort(), ["data.read", "data.write", "notifications", "workspace.ui"]);
// Since 0.1.5: standalone reminders (message + date/time, no Automations or
// Calendar involved) fire their own OS toast, so this plugin now declares
// the permission itself instead of only ever reading what Automations wrote.
assert.ok(declared.permissions.includes("notifications"), "standalone reminders call context.notifications.show directly");
assert.ok(!declared.permissions.includes("network"), "notifications never leave the machine on their own");
assert.equal(NOTIFICATION_TYPE, "notification");
assert.equal(REMINDER_TYPE, "reminder");

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

// --- parseReminder: a malformed or partial props blob must not throw
assert.deepEqual(
  parseReminder({ id: "r1", props: JSON.stringify({ message: "Call the dentist", dueAt: 5000, fired: false }), created_at: "2026-01-01T00:00:00Z", updated_at: "x" }),
  { id: "r1", message: "Call the dentist", dueAt: 5000, fired: false, updatedAt: "x" },
);
assert.equal(parseReminder({ id: "r2", props: "not json", created_at: "2026-01-01T00:00:00Z", updated_at: "x" }).fired, false, "a malformed props blob reads as unfired, not dropped");
assert.equal(parseReminder({ id: "r3", props: "{}", created_at: "2026-01-01T00:00:00Z", updated_at: "x" }).message, "", "props missing `message` falls back to empty, not a thrown error");

// --- dueLabel
const dueNow = Date.parse("2026-08-26T09:00:00");
assert.equal(dueLabel(dueNow + 3 * 3600_000, dueNow), `Today, ${new Date(dueNow + 3 * 3600_000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`);
assert.ok(dueLabel(dueNow + 26 * 3600_000, dueNow).startsWith("Tomorrow, "), "26 hours out, but past local midnight, must read as Tomorrow");
assert.equal(dueLabel(dueNow - 1000, dueNow), "Overdue", "a due moment already in the past must read as Overdue, not a stale time");
assert.ok(!dueLabel(dueNow + 10 * 86400_000, dueNow).includes("Today"), "ten days out must fall back to a full date, not Today/Tomorrow");

const source = readFileSync(new URL("./main.js", import.meta.url), "utf8");

// --- manifest/behaviour wiring for the reminder feature
assert.ok(source.includes("context.scheduler.every(REMINDER_CHECK_INTERVAL_MS"), "reminders must be checked on a recurring background interval, not only when the panel is open");
assert.ok(source.includes("context.notifications.show"), "a due reminder must fire the OS toast, the same channel Automations' notify action uses");
assert.ok(source.includes("REMINDER_CATCH_UP_WINDOW_MS") && source.includes("overdueMs"), "a reminder missed while the app was closed must have a bounded catch-up window, not fire unboundedly late or not at all");

// --- no markup-assigning APIs: every string reaches the DOM through
// textContent, never through injected markup.
for (const banned of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"]) {
  assert.ok(!source.includes(banned), `main.js must not use ${banned}`);
}

console.log("Notible Notifications self-check passed.");
