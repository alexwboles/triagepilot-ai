# TriagePilot AI — Redesign Audit (2026-10-13)

Competitors researched: Superhuman (keyboard-first design; Split Inbox — VIPs/
Newsletters/Team; Cmd+K command palette for every action; minimal premium aesthetic;
snooze + reminders; inbox-zero workflow), Shortwave (AI email triage), SaneBox.

## Visual gaps
- Category filtering lives in the top "signal bar" digest as small pills — not the
  prominent Split Inbox tabs Superhuman users expect above the queue.
- No command palette — Superhuman's defining interaction (Cmd+K → any command).
- No inbox-zero concept: no "N to zero" progress, no done state.
- Identity ("The Dispatch Console": dark command bar, warm paper, signal vermilion)
  is already distinctive and category-appropriate — keep and extend.

## Functional gaps
- No split-inbox views (Focus = urgent+reply / FYI / Spam / Snoozed as first-class tabs).
- No unified command runner — actions are scattered across shortcuts, buttons, menus.
- No inbox-zero tracking or celebration.

## Redesign plan — "Superhuman-grade triage"
- Queue header gets Split Inbox tabs (Focus / FYI / Spam / Snoozed) with live
  counts; tabs drive the existing filter machinery. Digest bar keeps its summary role.
- Ctrl/Cmd+K command palette: fuzzy-filtered commands (go to split, mark handled,
  snooze 1h/4h/tomorrow, label 1–4, block/trust sender, delete, clear spam, load
  samples, toggle shortcuts). Keyboard navigable (up/down/enter/esc).
- Inbox-zero meter in the queue header: "N to zero"; done banner at zero.
- All existing features preserved (classifier learning, shortcuts, bulk actions,
  snooze, blocklist/trustlist, digest copy, intake).

## QA notes
- Desktop 1440 + mobile 390; iterate until commercial-grade.
