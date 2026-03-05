# CodeGrab — Gmail 2FA / OTP autofill for Chrome

> Like iOS AutoFill for security codes, but in your browser.
> Detects verification / OTP codes in new Gmail messages and shows a floating overlay so you can autofill them with one click.

---

## File structure

```
codecheck/
├── manifest.json       MV3 manifest
├── background.js       Service worker — polls Gmail API, extracts codes
├── content.js          Content script — shows overlay, handles autofill
├── overlay.css         Scoped styles for the floating overlay & toast
├── popup.html          Extension popup (sign-in / status / settings)
├── popup.css
├── popup.js
├── generate_icons.py   Script to regenerate icons (no dependencies)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Step 1 — Set up Google Cloud credentials

### 1.1 Create a project
1. Go to https://console.cloud.google.com/
2. Click the project dropdown → **New Project** → give it a name (e.g. *CodeGrab*) → **Create**.

### 1.2 Enable the Gmail API
1. In the left sidebar: **APIs & Services → Library**.
2. Search for **Gmail API** → click it → **Enable**.

### 1.3 Configure the OAuth consent screen
1. **APIs & Services → OAuth consent screen**.
2. Choose **External** (or Internal if you are in Google Workspace) → **Create**.
3. Fill in:
   - App name: `CodeGrab`
   - User support email: your email
   - Developer contact: your email
4. Click **Save and Continue** through the rest (you don't need scopes here).
5. On the **Test users** page, add your Gmail address so you can test while the app is in *Testing* mode.

### 1.4 Create an OAuth 2.0 Client ID
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Chrome Extension**.
3. For the **Extension ID** field, you need your extension's ID (see Step 2 below for how to get it).
   - If you haven't loaded the extension yet, load it first (Step 2) and then come back.
4. Copy the generated **Client ID** (looks like `xxxxxxxxxx.apps.googleusercontent.com`).

### 1.5 Put the Client ID in the manifest
Open `manifest.json` and replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with your real client ID:

```json
"oauth2": {
  "client_id": "123456789-abc.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"]
}
```

---

## Step 2 — Load the extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle, top-right corner).
3. Click **Load unpacked** → select the `codecheck` folder.
4. The extension appears with an ID like `abcdefghijklmnopqrstuvwxyz123456`.

Copy that ID — you need it in **Step 1.4** above when filling in the Chrome Extension OAuth client.

> If you edited the manifest after loading, click the **↺ reload** button on the extension card.

---

## Step 3 — Authorize the extension

1. Click the **CodeGrab** icon in the Chrome toolbar (pin it from the puzzle-piece menu if hidden).
2. Click **Sign in with Google** → choose your Gmail account → grant the *Read Gmail* permission.
3. The popup now shows **Monitoring Gmail** with a green pulsing dot.

---

## Step 4 — Test it

### Quick smoke test (no real email required)
1. Open any webpage that has an input field (even `https://google.com`).
2. Click into the search box.
3. Open the CodeGrab popup → click **Test overlay**.
4. A floating overlay should appear near the input showing code `847291` from *Google*.
5. Click **Autofill** — the code is typed into the field and copied to clipboard.

### Real Gmail test
1. Send yourself an email with subject *"Your verification code"* and body *"Your code is 382910"*.
2. Wait up to 30 seconds (default polling interval), or click **Check now** in the popup.
3. The overlay appears on whatever page you are on.

---

## How it works

| Component | Role |
|-----------|------|
| **background.js** | Runs every 30 s via `chrome.alarms`. Queries Gmail API for unread inbox messages newer than 3 minutes. Parses subject + body with regex. Broadcasts detected codes to all tabs. |
| **content.js** | Injected into every page. Tracks the last focused `<input>` / `<textarea>`. On receiving a code message, renders the overlay near that element (or top-right if no input is focused). |
| **overlay.css** | Scoped with `#cg-overlay` / `#cg-toast` — won't conflict with any website's styles. |
| **popup.js** | Talks to the background via `chrome.runtime.sendMessage`. Lets you sign in/out, toggle polling, and run a manual check. |

### Detected patterns

The extension recognises all common forms:

```
Your code is 123456
Verification code: 8392
OTP: 482910
Enter this code: AB3F92
Security code — 847291
One-time password: 382910
2FA code: 192837
Your login code is 554433
```

---

## Permissions used

| Permission | Why |
|------------|-----|
| `identity` | OAuth2 sign-in via `chrome.identity.getAuthToken` |
| `storage` | Persist auth state, processed email IDs, last found code |
| `alarms` | Poll Gmail every 30 seconds |
| `tabs` | Enumerate open tabs to broadcast the code |
| `clipboardWrite` | Copy code to clipboard as a backup |
| `https://gmail.googleapis.com/*` | Gmail API calls |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Sign-in fails / no Google prompt | Make sure `client_id` in `manifest.json` matches the OAuth credential you created for **this extension's ID**. |
| "Error 400: redirect_uri_mismatch" | The extension ID in Google Cloud Console doesn't match the loaded extension's ID. Re-check both. |
| Overlay never appears | Open DevTools → Console on any tab. Background errors appear in the service worker DevTools (click the *service worker* link on `chrome://extensions`). |
| Codes not detected | Click **Check now** in popup. If `found: false`, try sending a test email with a plain `"code: 123456"` in the body. |
| Overlay appears on Gmail itself | That's intentional — it still works. Click Autofill to paste into Gmail's search box, or dismiss with ×. |

---

## Privacy

- CodeGrab only requests **read-only** Gmail access (`gmail.readonly`).
- Email content is processed entirely **locally in your browser** — nothing is sent to any server.
- The OAuth token is stored in Chrome's identity cache and never leaves your machine.
