# FinAI Search — Setup Guide
## Get JARVIS searching YouTube + the web in ~10 minutes

---

## Step 1 — YouTube Data API Key (Free)

1. Go to: https://console.cloud.google.com/
2. Create a new project (or use existing) → name it "FinAI"
3. Click **"APIs & Services"** → **"Enable APIs and Services"**
4. Search for **"YouTube Data API v3"** → click Enable
5. Go to **"Credentials"** → **"Create Credentials"** → **"API Key"**
6. Copy the key → click "Restrict Key"
   - Under "API restrictions" → select "YouTube Data API v3" only
   - Under "Application restrictions" → add your Vercel domain
7. Click Save

**Free quota:** 10,000 units/day. One search = ~100 units. That's ~100 searches/day free.

---

## Step 2 — Tavily API Key (Free for web search)

1. Go to: https://tavily.com/
2. Sign up (free) → go to Dashboard
3. Copy your API key

**Free quota:** 1,000 searches/month. Upgrade to $9/mo for 4,000/month.

---

## Step 3 — Add keys to Vercel

1. Go to your Vercel project dashboard
2. Click **Settings** → **Environment Variables**
3. Add these two variables:

```
YOUTUBE_API_KEY = AIza... (your YouTube key)
TAVILY_API_KEY  = tvly-... (your Tavily key)
```

4. Set both to: ✅ Production  ✅ Preview  ✅ Development
5. Click **Save** → **Redeploy** your project

---

## Step 4 — Test it

Once deployed, say to JARVIS:
- **"Hey JARVIS, find free courses on sales"**
- **"Hey JARVIS, find videos on how to invest in ETFs"**
- **"Hey JARVIS, find articles on crypto tax"**

Results appear as tappable cards in the JARVIS chat. JARVIS also speaks the top 2 results aloud.

---

## What works without keys

If you skip Tavily, JARVIS still searches YouTube (just no web results).  
If you skip YouTube, JARVIS still searches the web (just no video results).  
Both keys missing → JARVIS will tell you search isn't configured.

---

## Privacy notes

- No user queries are logged or stored anywhere
- Search queries are sanitized before hitting APIs  
- Only the sanitized query (not the raw voice transcript) is forwarded
- YouTube + Tavily only receive the topic string — never any user account info
