# Connecting Gmail to TriagePilot AI

TriagePilot can triage your **real Gmail inbox** through Google's free OAuth 2.0.
You create the OAuth credentials in your own Google Cloud project — TriagePilot
never sees them, never stores them, and never sends them anywhere. Read-only
access: the app can read mail, never send, delete, or change anything.

Cost: **$0** — Gmail API read access is free. No API key to buy, no subscription.

---

## One-time setup (~10 minutes)

### 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in with the Google account
   whose Gmail you want to triage.
2. Click the project picker (top-left) → **New Project** → name it e.g.
   `triagepilot-local` → **Create**.

### 2. Enable the Gmail API

1. In the new project, open **APIs & Services → Library**.
2. Search **"Gmail API"** → click it → **Enable**.

### 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. User type: **External** → **Create**.
3. App name: `TriagePilot AI (local)`; user support email: your address;
   developer contact: your address → **Save and continue**.
4. **Scopes** page → **Add or remove scopes** → search and tick
   `.../auth/gmail.readonly` → **Update** → **Save and continue**.
   (This is the *only* scope TriagePilot requests — read-only.)
5. **Test users** page → **Add users** → add the Gmail address you will sign in
   with → **Save and continue**. (External apps in "Testing" mode only work
   for listed test users.)

### 4. Create the OAuth client ID

1. Go to **APIs & Services → Credentials** → **Create credentials** →
   **OAuth client ID**.
2. Application type: **Web application**. Name it `TriagePilot AI browser`.
3. Under **Authorized JavaScript origins**, click **Add URI** and add the
   address you serve TriagePilot from, for example:
   - `http://localhost:3000` (if you run `npx serve .`)
   - `http://127.0.0.1:3000`
   - your LAN address if you open it from a phone, e.g. `http://192.168.1.42:3000`
   - ⚠️ `file://` (double-clicking `index.html`) does **not** work with Google
     OAuth — serve the folder over `http://` instead.
4. You do **not** need "Authorized redirect URIs" — the app uses the popup
   token flow. Leave it empty.
5. Click **Create** → copy the **Client ID** (looks like
   `123456789012-abc…xyz.apps.googleusercontent.com`).
   Do **not** copy the client *secret* anywhere — a browser-only app never
   needs it, and it must never go into a file the app serves.

### 5. Paste the client ID into TriagePilot's local config

1. In the `triagepilot-ai` folder, copy `config/gmail.local.example.js` to
   `config/gmail.local.js`:

   ```bash
   cp config/gmail.local.example.js config/gmail.local.js
   ```

   (`config/gmail.local.js` is gitignored — it stays on your machine and is
   never committed.)
2. Open `config/gmail.local.js` and replace `YOUR_CLIENT_ID` with the client ID
   from step 4.
3. Reload TriagePilot. The Gmail panel (Intake column) now shows
   **Connect Gmail**.

---

## Using it

1. Click **Connect Gmail** → a Google popup asks you to pick your account and
   approve **read-only** access ("View your email messages"). Approve.
2. Click **Sync inbox** — TriagePilot pulls your 25 most recent inbox emails,
   triages them with the same classifier (learned rules, sender lists,
   per-sender memory all apply), and skips anything already imported.
3. Click **Disconnect** any time to forget the token. You can also revoke
   access permanently at <https://myaccount.google.com/permissions>.

## Privacy & safety

- **Read-only.** The requested scope is `gmail.readonly`. TriagePilot cannot
  send, delete, label, or archive your mail.
- **Tokens live in browser memory only.** The OAuth access token is never
  written to `localStorage`, never logged, and never sent to any server —
  TriagePilot has no server. It exists only until you close the tab or click
  Disconnect.
- **Your client ID is a public identifier, not a password**, but keep the
  config file local anyway (it's gitignored). Never add the client *secret*
  to this app.
- **Email content stays in your browser.** Classification runs on the same
  local engine as pasted emails — nothing is uploaded anywhere.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Gmail panel says "not configured" | `config/gmail.local.js` missing or the client ID wasn't pasted — re-do step 5. |
| Google popup: "Error 403: access_denied" | Your Gmail address isn't on the consent screen's **Test users** list (step 3.5). |
| Google popup: "Error 400: redirect_uri_mismatch" | You're opening TriagePilot from an origin not listed under **Authorized JavaScript origins** (step 4.3). Use `npx serve .` and the exact listed URL. |
| Popup blocked / immediately closes | Allow popups for your local address, or retry — `requestAccessToken({ prompt: 'consent' })` needs the popup. |
| Sync finds 0 emails | The default query is `in:inbox newer_than:30d`. Use Gmail search syntax in the app? The current build syncs the recent inbox; narrow via Gmail filters server-side. |
| `file://` does nothing on Connect | Expected — Google OAuth requires `http://`/`https://`. Run `npx serve .` and open the shown URL. |

## For developers

`js/gmail.js` is the integration module (browser + Node, UMD like the
classifier). Every Gmail API function takes an injectable `fetch`, so the
full sync flow is tested with mocked responses — no real Google credentials
in tests. See `test/e2e.sh` (Gmail flows) and the module header for details.
