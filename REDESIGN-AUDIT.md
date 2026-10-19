# TriagePilot AI — Redesign Audit v2 (2026-10-19)

## Competitors studied

- **Superhuman** (superhuman.com + reviews): keyboard-first everything, Split Inbox
  (Important/Calendar/Newsletters + *custom* splits), Cmd+K command palette,
  **Snippets** (reusable reply templates), **Remind me** (bring a thread back),
  follow-up nudges, inbox-zero as the core metric, sub-100ms feel, minimal
  dense premium aesthetic.
- **Shortwave** (shortwave.com): **Bundles** — group newsletters/promotions/contact
  mail into one collapsible item for bulk triage; split inboxes per sender/label/
  query; AI filters written in plain English; delivery schedules; "processed,
  not empty" triage philosophy; tl;dr thread summaries.
- **Missive** (missiveapp.com): **turn an email into a task** with owner + due date;
  internal comments threaded on the message; assignments = clear ownership;
  rules engine (time-based SLA warnings); canned responses; Observer role.

(v1 audit, 2026-10-13, covered Superhuman split inbox, Cmd+K, and inbox-zero —
all already shipped. This audit is about what remains.)

## 6 layout/IA/visual patterns worth borrowing

1. **Superhuman's single-stream density.** One dense column, urgent-first sorting,
   zero decorative whitespace between rows; the row itself carries category,
   confidence, and state as inline rails — not cards.
2. **Shortwave's bundles.** Group-by-sender collapsed rows that let you triage a
   whole sender at once ("snooze/delete/mark done the entire bundle"). The mental
   model is *per-sender triage*, which maps directly onto TriagePilot's per-sender
   memory.
3. **Missive's task conversion.** Every email can become a task with a due date;
   tasks live in their own lane, with overdue visibly flagged. Turns triage into
   a commitment device.
4. **Superhuman's snippets.** Named reply templates, insertable in one keystroke,
   maintained in one place. Missive's canned responses confirm this is table
   stakes for anyone answering mail at volume.
5. **Superhuman's "N to zero" meter placement.** The metric sits *inside* the
   queue header as a persistent countdown, not in a separate dashboard.
6. **Shortwave's "processed, not empty" philosophy.** Triage states are explicit
   and searchable (done, snoozed, task) — nothing vanishes; everything has a
   place you can get back to.

## Top 3 functional gaps vs competitors (closed in v2)

1. **No task layer.** Missive turns any email into a task with a due date;
   Superhuman has Remind-me; TriagePilot only had snooze. → **Tasks**: one-click
   "make it a task" (today/tomorrow/next week/pick a date), a first-class
   **Tasks split tab** with live count, overdue ribbons, due-date sorting,
   and Cmd+K commands. Persisted in the email record; survives snooze.
2. **No sender-centric triage.** Shortwave's bundles triage whole senders at once;
   TriagePilot's per-sender memory had no UI surface. → **Sender bundles**:
   click any sender name in the queue to drop into that sender's view — every
   mail they've sent, with the full bulk-action bar available. Dossier gets an
   "All from sender" jump. Classification re-triage on block/trust already
   existed; now the sender is a first-class triage axis.
3. **No reply snippets.** Superhuman snippets / Missive canned responses are the
   standard answer to repetitive mail; TriagePilot regenerated every draft from
   scratch. → **Snippets**: named reusable replies, insert into the draft with
   one click, save the current draft as a snippet, delete, persisted in
   localStorage, and a per-snippet command in Cmd+K.

## New distinctive visual identity — "The Dispatch Console, v2"

The v1 identity (dark command bar, warm paper board, signal-vermilion accent,
sharp corners) stays — it is already category-correct for *email triage as air
traffic control*. v2 deepens it instead of re-skinning:

- **Layered command deck.** The header becomes a two-tier deck: brand + session
  controls on top, a mono "signal ticker" (open count · tasks overdue · N to
  zero) below. Diagonal pinstripe texture at 3% opacity; an angled vermilion
  rail slices the split-tab row (clip-path, sharp).
- **Case-file dossier.** The classification block becomes a dossier card: an SVG
  confidence *ring* (replacing the flat bar), category-colored left rail, and a
  "WHY" field styled as a typed case note. Actions are grouped under labeled
  rails: TRIAGE / REPLY / SENDER / TASK — like a dispatcher's action ledger.
- **Sender avatar chips.** Queue rows get an overlapping initial-chip (layered,
  not boxed) — the sender becomes a visual anchor, supporting the new sender
  bundles.
- **Typography.** Display serif (Iowan Old Style / Palatino / Georgia — no web
  font, fully offline) for pane headings; mono for stats/counts/keys; system
  sans for body. Vermilion reserved for urgent + primary action only.
- **Motion.** Keep the restrained rise-in; add a 120ms row-hover lift and a
  palette open/close scale. All disabled under prefers-reduced-motion.

## Rules compliance

- Zero border-radius / sharp edges everywhere. No purple/blue gradients. No
  emoji chrome (✔/× are glyphs in pills, as before). All Gmail OAuth, sender
  memory, sent-tracking, snooze, and Cmd+K features preserved; IDs unchanged or
  added, never removed. GMAIL-SETUP.md flow untouched.

## QA notes

- Desktop 1440×900 + mobile 390×844 via shot.py; shots under
  redesign-shots/v2/. Gmail OAuth popup cannot be exercised headless — shot the
  setup-guide state (default) and the connect-prompt state (temp
  config/gmail.local.js, removed afterward, gitignored so it never commits).
