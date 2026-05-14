# FinAI Owner Mode — Setup Guide
## Connect your real accounts to JARVIS in ~30 minutes

Owner mode gives you a personal JARVIS that knows your real bank balances, investment holdings, upcoming financial events, financial emails, and YouTube finance subscriptions. Everything is gated server-side — public users get a flat 403 and never see your data.

---

## Overview — What you'll set up

| Integration | What it does | Env vars needed |
|-------------|-------------|-----------------|
| Owner identity | Unlocks owner mode | `OWNER_GOOGLE_ID` |
| Google OAuth app | Powers Gmail, Calendar, Sheets, YouTube | `GOOGLE_CLIENT_SECRET` |
| Gmail | Financial emails in JARVIS context | `OWNER_GMAIL_REFRESH_TOKEN` |
| Google Calendar | Upcoming financial events | `OWNER_GCAL_REFRESH_TOKEN` |
| Google Sheets | Personal finance spreadsheet R/W | `OWNER_GSHEETS_REFRESH_TOKEN`, `OWNER_SHEETS_ID` |
| YouTube OAuth | Your liked videos + subscriptions | `OWNER_YOUTUBE_REFRESH_TOKEN` |
| Plaid | Real bank/brokerage balances + holdings | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `OWNER_PLAID_ACCESS_TOKEN` |

---

## Step 0 — Find your Google UID (`OWNER_GOOGLE_ID`)

Your owner Google UID is the `sub` field in your Google identity token. It looks like: `109234567890123456789`

**Easiest way to find it:**

1. Open the deployed FinAI app and sign in with Google (your personal account)
2. Open browser DevTools → **Network** tab → filter by `config`
3. Find the request to `/api/config` → click it → **Headers** tab
4. Copy the value after `Authorization: Bearer ` — that's your Google token
5. Paste it into this URL in a new tab (replace `TOKEN`):
   ```
   https://oauth2.googleapis.com/tokeninfo?id_token=TOKEN
   ```
6. Find the `"sub"` field in the JSON response — that's your `OWNER_GOOGLE_ID`

> **Alternative:** If you used the regular Google Sign-In flow (not One Tap), your token is an access token, not an ID token. Use this URL instead:
> ```
> https://oauth2.googleapis.com/tokeninfo?access_token=TOKEN
> ```

---

## Step 1 — Google OAuth App (one-time setup for Gmail, Calendar, Sheets, YouTube)

All four Google integrations share one OAuth 2.0 client. You may already have one from setting up Google Sign-In — just add the extra APIs and scopes.

### 1a. Enable the required APIs

1. Go to: https://console.cloud.google.com/
2. Select your **FinAI** project (or the project where your existing Google Client ID lives)
3. Click **APIs & Services** → **Enable APIs and Services**
4. Search for and **Enable** each of these (one at a time):
   - **Gmail API**
   - **Google Calendar API**
   - **Google Sheets API**
   - **YouTube Data API v3** (may already be enabled from SEARCH_SETUP)

### 1b. Add OAuth redirect URI

1. Go to **APIs & Services** → **Credentials**
2. Click your existing **OAuth 2.0 Client ID** (the one used for `GOOGLE_CLIENT_ID`)
3. Under **Authorized redirect URIs**, click **Add URI** and add:
   ```
   https://developers.google.com/oauthplayground
   ```
4. Click **Save**
5. Click **Download JSON** (or copy **Client ID** + **Client Secret** from the UI)

The **Client Secret** = `GOOGLE_CLIENT_SECRET`

---

## Step 2 — Get OAuth Refresh Tokens (Gmail, Calendar, Sheets, YouTube)

Use Google's OAuth Playground to get refresh tokens without writing code. You can authorize all four scopes in one session.

1. Go to: https://developers.google.com/oauthplayground
2. Click the **gear icon** (⚙️) in the top-right → check **"Use your own OAuth credentials"**
3. Paste your **OAuth Client ID** and **Client Secret** → close the panel

### 2a. Select scopes

In the left panel, scroll down and select these scopes (or paste them manually into the input box):

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/youtube.readonly
```

4. Click **Authorize APIs** → sign in with your **owner** Google account → allow all permissions

### 2b. Exchange for tokens

5. Click **Exchange authorization code for tokens**
6. In the response on the right, find **`refresh_token`** — copy it

> This single refresh token covers all four scopes you authorized. You can use it for all four integrations — or repeat the process with individual scopes if you prefer separate tokens.

**Assign the token to your env vars:**

```
OWNER_GMAIL_REFRESH_TOKEN     = 1//0e...  (the refresh_token from step 6)
OWNER_GCAL_REFRESH_TOKEN      = 1//0e...  (same token, or repeat for calendar only)
OWNER_GSHEETS_REFRESH_TOKEN   = 1//0e...  (same token, or repeat for sheets only)
OWNER_YOUTUBE_REFRESH_TOKEN   = 1//0e...  (same token, or repeat for YouTube only)
```

> If you want tighter scoping, repeat steps 2a–2b with only one scope at a time and use separate tokens for each service.

---

## Step 3 — Google Sheets ID (`OWNER_SHEETS_ID`)

JARVIS can read and append rows to your personal finance spreadsheet.

1. Open (or create) your spreadsheet at https://sheets.google.com
2. Look at the URL — it will look like:
   ```
   https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit
   ```
3. Copy the long string between `/d/` and `/edit` — that's your `OWNER_SHEETS_ID`

**Recommended sheet structure** (JARVIS can append rows to this):

| Date | Category | Description | Amount | Account |
|------|----------|-------------|--------|---------|

---

## Step 4 — Plaid (Real Bank & Brokerage Data)

Plaid's development tier is free for personal use and gives JARVIS access to your real account balances, transactions, and investment holdings.

### 4a. Create a Plaid account

1. Go to: https://plaid.com → click **Get API Keys**
2. Sign up (free) → Dashboard → **Team Settings** → **Keys**
3. Copy:
   - `client_id` → `PLAID_CLIENT_ID`
   - `secret` (use the **Development** secret, not Sandbox) → `PLAID_SECRET`
4. Set `PLAID_ENV=development`

### 4b. Link your bank account and get an access token

Plaid requires you to complete their Link flow once to get an `access_token`. The quickest way is their official Quickstart:

1. Clone the Plaid Quickstart locally:
   ```bash
   git clone https://github.com/plaid/quickstart.git
   cd quickstart/node
   ```
2. Copy `.env.example` to `.env` and fill in your `PLAID_CLIENT_ID` and `PLAID_SECRET`:
   ```
   PLAID_CLIENT_ID=...
   PLAID_SECRET=...
   PLAID_ENV=development
   PLAID_PRODUCTS=transactions,investments
   PLAID_COUNTRY_CODES=US
   ```
3. Run the quickstart:
   ```bash
   npm install
   node index.js
   ```
4. Open http://localhost:8000 in your browser → click **Connect a bank** → follow the Plaid Link UI to connect your bank
5. After connecting, the quickstart prints your `access_token` in the terminal
6. Copy it → `OWNER_PLAID_ACCESS_TOKEN`

> **Sandbox mode:** If you don't want to link a real bank yet, set `PLAID_ENV=sandbox` and use Plaid's test credentials (username: `user_good`, password: `pass_good`). You'll get realistic fake data for testing.

> **Investment accounts:** Plaid supports most major brokerages (Fidelity, Schwab, Vanguard, Robinhood, etc.) — select "Investments" in the products list and link your brokerage the same way.

---

## Step 5 — Add all env vars to Vercel

1. Go to your Vercel project → **Settings** → **Environment Variables**
2. Add each variable below (set all to ✅ Production ✅ Preview ✅ Development):

```
OWNER_GOOGLE_ID               = 109234567890123456789
GOOGLE_CLIENT_SECRET          = GOCSPX-...

OWNER_GMAIL_REFRESH_TOKEN     = 1//0e...
OWNER_GCAL_REFRESH_TOKEN      = 1//0e...
OWNER_GSHEETS_REFRESH_TOKEN   = 1//0e...
OWNER_SHEETS_ID               = 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms

OWNER_YOUTUBE_REFRESH_TOKEN   = 1//0e...

PLAID_CLIENT_ID               = 6...
PLAID_SECRET                  = ...
PLAID_ENV                     = development
OWNER_PLAID_ACCESS_TOKEN      = access-development-...
```

3. Click **Save** → go to **Deployments** → click **Redeploy** on the latest deployment (with "Use existing build cache" **unchecked**)

---

## Step 6 — Test each integration

### Owner identity
- Sign in with your Google account → a ⚡ button should appear in the bottom-right corner
- Click it → the **Owner Hub** panel should open

### Accounts tab (Plaid)
- Open Owner Hub → **Accounts** tab
- Should show your real bank accounts with balances and investment holdings
- If it shows "Not connected": check `PLAID_CLIENT_ID`, `PLAID_SECRET`, `OWNER_PLAID_ACCESS_TOKEN`, `PLAID_ENV`

### Calendar tab (Google Calendar)
- Open Owner Hub → **Calendar** tab
- Should show upcoming events with financial keywords (bills, taxes, earnings, etc.)
- If empty: either no financial events in the next 60 days, or check `OWNER_GCAL_REFRESH_TOKEN`

### Email tab (Gmail)
- Open Owner Hub → **Email** tab
- Should show recent financial emails (bank statements, receipts, invoices)
- If empty: check `OWNER_GMAIL_REFRESH_TOKEN`; note the filter only surfaces financial-keyword emails

### YouTube tab
- Open Owner Hub → **YouTube** tab
- Should show your finance channel subscriptions as tags
- If empty: check `OWNER_YOUTUBE_REFRESH_TOKEN`

### Personalized JARVIS
- Open Owner Hub → **JARVIS** tab → enable **Personalized JARVIS** toggle
- Ask JARVIS: *"What's my current portfolio value?"* or *"What bills do I have coming up?"*
- JARVIS should reference your real Plaid data and calendar events
- The Owner Hub must have loaded data in the other tabs first (data is cached in-session)

### Security check
- Open a private/incognito window → go to the app → **do not** sign in
- Visit `/api/plaid` directly → should return `403 Forbidden`
- Sign in with a different (non-owner) Google account → no ⚡ button should appear

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| ⚡ button doesn't appear | `OWNER_GOOGLE_ID` is wrong or missing | Double-check the `sub` value from tokeninfo |
| Accounts tab shows error | Plaid access token expired or wrong env | Re-run Plaid Quickstart to get a fresh token |
| `invalid_grant` in server logs | Refresh token revoked | Re-authorize in OAuth Playground |
| Calendar/Email empty | No financial-keyword events/emails | Check with broader date range; tokens are working if no error |
| 503 "not configured" | Env var missing from Vercel | Check Settings → Env Vars; redeploy after adding |
| Google sign-in fails (404) | `GOOGLE_CLIENT_ID` missing in Vercel | Add it and redeploy |

---

## Security notes

- All owner routes verify your session server-side before returning any data — public users get 403 with no hints
- Refresh tokens are stored only in Vercel's encrypted environment variables, never in the browser
- The owner session uses an HttpOnly cookie (not localStorage) so XSS cannot extract it
- Google refresh tokens don't expire unless you revoke them or don't use them for 6 months
- Plaid access tokens don't expire for development tier; production tokens can require periodic re-auth
- You can revoke all Google access at any time: https://myaccount.google.com/permissions
