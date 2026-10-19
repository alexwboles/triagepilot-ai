# TriagePilot AI 📥

**Urgent first. Drafts written. Noise filtered.**

Business owners drown in email — quote requests, complaints, spam, receipts, all mixed together. TriagePilot sorts the inbox in one click and drafts the replies, so the owner handles what matters and ignores the rest.

## The problem

A typical small-business owner gets 50–150 emails a day. Urgent customer problems hide between newsletters and spam. Every hour spent triaging email is an hour not earning.

## The solution

- **Real Gmail connection (OAuth 2.0)** — connect your actual Gmail with your own free Google Cloud client ID (`docs/GMAIL-SETUP.md`, ~10 min). Read-only scope; the token lives in the tab's memory only. Sync pulls your 25 most recent inbox emails straight into the triage queue — no pasting.
- **Paste-in inbox** — still there: paste any email (subject + body) or load the bundled sample inbox of 10 realistic business emails.
- **AI triage** — a local classifier sorts every email into **Urgent / Needs reply / FYI / Spam**, with a confidence level and a plain-language reason ("Flagged as Urgent because: water damage / flooding; angry customer language.").
- **Learns from you** — correcting a label teaches the classifier distinctive keywords AND remembers the sender: future mail from that sender files the way you filed it (per-sender memory). Blocklist/trustlist included for explicit control.
- **Reply drafter** — one click generates an editable professional reply, in **professional** or **friendly** tone. Copy it, open it in your email app via `mailto:`, or hit **Reply sent** to close the loop — the email is marked handled and counted in the digest (sent tracking).
- **Snooze loop** — snooze an email for 1h / 4h / until tomorrow 9am; it vanishes from the queue and resurfaces when the snooze expires.
- **Daily digest** — "10 emails triaged · 2 urgent · 3 need replies · 1 reply sent" summary bar; inbox auto-sorts urgent-first.
- **100% local, private** — no servers, no accounts, no tracking. Nothing you paste ever leaves the browser. Works offline (offline = paste-in mode; Gmail sync needs the network, obviously).

No API key required — classification and drafting work out of the box with built-in heuristics and templates. (A future version may optionally use an owner's own OpenAI key for fancier drafts; the local engine always remains the fallback.)

## Run it

No build step. Either:

```bash
# option 1: open directly
open index.html        # or double-click it

# option 2: local server (needed for the fetch()-loaded sample inbox)
npx serve .
# then visit http://localhost:3000
```

> The Gmail connection requires option 2 (a local server): Google OAuth only
> allows `http://`/`https://` origins, not `file://`. See `docs/GMAIL-SETUP.md`.

## Tests

Standing dev rule: smoke + e2e must pass before any release.

```bash
bash test/smoke.sh   # 38 checks: files, syntax, classifier + gmail loads, key samples, drafts, learned rules, no hardcoded credentials, UI wiring
bash test/e2e.sh     # 23 flows: digest, urgent, spam, drafts, tones, paste-in, accuracy, snooze, sender lists, sender memory, sent tracking, Gmail parse + mocked sync
```

Gmail tests use a **mocked `fetch`** — the full list→fetch→map sync flow is exercised with canned Gmail API responses, so no real Google credentials are ever needed.

## Pricing idea

$24/mo per business — "your inbox, triaged before coffee." Pays for itself the first time an urgent customer email gets answered same-day instead of buried.

## Project layout

```
index.html            UI shell
css/style.css         styling
js/classifier.js      triage classifier + reply drafter + learning (browser + node)
js/gmail.js           Gmail OAuth 2.0 + REST client (browser + node, fetch injectable for tests)
js/app.js             UI wiring (browser only)
config/gmail.local.example.js   template for your local Gmail client-ID config (gitignored)
docs/GMAIL-SETUP.md   10-minute Gmail connection guide
data/samples.json     10 realistic sample business emails (with expected labels)
test/smoke.sh         fast sanity checks
test/e2e.sh           end-to-end flows
```

## Privacy note

All processing happens locally in the browser. Pasted emails are never sent anywhere — there is no backend to send them to.

**Gmail connection:** uses the official Google Identity Services OAuth 2.0 flow with the **read-only** `gmail.readonly` scope — TriagePilot cannot send, delete, or change your mail. Your client ID lives in the gitignored `config/gmail.local.js` on your machine; the access token is held in the browser tab's memory only (never `localStorage`, never logged, never sent to any server but Google's). Disconnect any time, or revoke at myaccount.google.com/permissions.
