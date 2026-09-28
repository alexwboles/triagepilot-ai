# TriagePilot AI 📥

**Urgent first. Drafts written. Noise filtered.**

Business owners drown in email — quote requests, complaints, spam, receipts, all mixed together. TriagePilot sorts the inbox in one click and drafts the replies, so the owner handles what matters and ignores the rest.

## The problem

A typical small-business owner gets 50–150 emails a day. Urgent customer problems hide between newsletters and spam. Every hour spent triaging email is an hour not earning.

## The solution

- **Paste-in inbox** — paste any email (subject + body) or load the bundled sample inbox of 10 realistic business emails.
- **AI triage** — a local classifier sorts every email into **Urgent / Needs reply / FYI / Spam**, with a confidence level and a plain-language reason ("Flagged as Urgent because: water damage / flooding; angry customer language.").
- **Reply drafter** — one click generates an editable professional reply, in **professional** or **friendly** tone. Copy it, or open it in your email app via `mailto:`.
- **Daily digest** — "10 emails triaged · 2 urgent · 3 need replies" summary bar; inbox auto-sorts urgent-first.
- **100% local, private** — no servers, no accounts, no tracking. Nothing you paste ever leaves the browser. Works offline.

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

## Tests

Standing dev rule: smoke + e2e must pass before any release.

```bash
bash test/smoke.sh   # 16 checks: files, syntax, classifier loads, key samples, drafts
bash test/e2e.sh     # 7 flows: digest, urgent, spam, drafts, tones, paste-in, accuracy
```

## Pricing idea

$24/mo per business — "your inbox, triaged before coffee." Pays for itself the first time an urgent customer email gets answered same-day instead of buried.

## Project layout

```
index.html            UI shell
css/style.css         styling
js/classifier.js      triage classifier + reply drafter (browser + node)
js/app.js             UI wiring (browser only)
data/samples.json     10 realistic sample business emails (with expected labels)
test/smoke.sh         fast sanity checks
test/e2e.sh           end-to-end flows
```

## Privacy note

All processing happens locally in the browser. Pasted emails are never sent anywhere — there is no backend to send them to.
