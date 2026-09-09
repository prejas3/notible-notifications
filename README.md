# Notible Notifications

A bell icon in the sidebar, with an unread count and a short in-app log of
what Automations' "notify" action has fired.

## Why

Automations' `notify` action already shows a native OS toast (API 1.10). A
toast is fire-and-forget: dismiss it, miss it while the window is
unfocused, or step away from the machine, and it is gone for good. This
plugin does not change that action — it reads back the plain workspace
object Automations writes alongside every toast (type `notification`) and
draws it as a short, readable log: newest first, an unread dot until you
open it, a one-click "Clear".

## What it stores

Each entry is an ordinary workspace object of type `notification`:

- `title` — the notification's title
- `props.body` — the notification's body, if any
- `props.read` — whether you have opened it
- `props.at` — when it fired, in epoch milliseconds

It is hidden from the note tree the same way a habit is: it is not a note,
it is a log entry, and the app hides both by type so an automation running
overnight does not leave a trail of empty-looking "notes" behind it.

The log is capped at 200 entries; older ones are trimmed on open. The
durable record of what a rule *did* is Automations' own execution log — this
is only the notice that it did it.

## Requires

- `notible.automations` to actually produce entries. Installed on its own,
  the bell shows an empty state.

## Permissions

`data.read`, `data.write`, `workspace.ui`. No `notifications` (OS toast)
permission — that one belongs to Automations, which is the plugin that
calls `context.notifications.show`.

## Install

In Notible: **Settings -> Plugins -> Market**, then install "Notible Notifications".
This repo is the source; the market pulls `plugin.json` + `notible.notifications.zip` from the latest GitHub Release.
