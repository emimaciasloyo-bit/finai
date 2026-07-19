/**
 * FinAI — Google Data Proxy (owner-only)
 * Consolidated dispatcher for Gmail, Google Calendar, Google Sheets, and YouTube.
 * Route via ?svc=gmail|gcal|gsheets|youtube
 *
 * Auth: requires valid owner session cookie (set by /api/owner-session).
 * Env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET + per-service refresh tokens.
 */

import { isOwnerSession } from './owner-session.js';

const ipStore = new Map();
const RATE_LIMIT = 30;
setInterval(() => { const n = Date.now(); for (const [k,v] of ipStore) if (n > v.resetAt) ipStore.delete(k); }, 60000);
function rateLimit(ip) {
  const now = Date.now();
  let e = ipStore.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60000 }; ipStore.set(ip, e); }
  e.count++;
  return { allowed: e.count <= RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - e.count), resetAt: e.resetAt };
}

const OAUTH_URL    = 'https://oauth2.googleapis.com/token';
const GMAIL_BASE   = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GCAL_BASE    = 'https://www.googleapis.com/calendar/v3';
const SHEETS_BASE  = 'https://sheets.googleapis.com/v4/spreadsheets';
const YT_BASE      = 'https://www.googleapis.com/youtube/v3';

async function getToken(refreshToken) {
  const r = await fetch(OAUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('Token refresh failed');
  return (await r.json()).access_token;
}

// ── Gmail ────────────────────────────────────────────────────────
const FINANCE_QUERY = [
  'from:no-reply@chase.com OR from:service@paypal.com',
  'OR subject:(statement OR "trade confirmation" OR "account summary")',
  'OR subject:(dividend OR deposit OR withdrawal OR "tax document" OR "1099" OR "W-2")',
  'OR subject:(invoice OR receipt OR payment OR bill)',
].join(' ');

async function handleGmail(req, res) {
  if (!process.env.OWNER_GMAIL_REFRESH_TOKEN)
    return res.status(503).json({ error: 'Gmail not connected' });

  const maxResults = Math.min(parseInt(req.query?.max || '20', 10), 50);
  const token   = await getToken(process.env.OWNER_GMAIL_REFRESH_TOKEN);
  const headers = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(
    `${GMAIL_BASE}/messages?q=${encodeURIComponent(FINANCE_QUERY)}&maxResults=${maxResults}&fields=messages(id)`,
    { headers, signal: AbortSignal.timeout(10000) }
  );
  if (!listRes.ok) throw new Error(`Gmail list error ${listRes.status}`);
  const list = await listRes.json();

  if (!list.messages?.length) return res.status(200).json({ emails: [] });

  const emails = (await Promise.allSettled(
    list.messages.map(m =>
      fetch(
        `${GMAIL_BASE}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&fields=id,snippet,payload/headers`,
        { headers, signal: AbortSignal.timeout(8000) }
      ).then(r => r.ok ? r.json() : null)
    )
  )).map(r => {
    if (r.status !== 'fulfilled' || !r.value) return null;
    const msg = r.value;
    const hdr = name => msg.payload?.headers?.find(h => h.name === name)?.value || '';
    return { id: msg.id, from: hdr('From'), subject: hdr('Subject'), date: hdr('Date'), snippet: msg.snippet };
  }).filter(Boolean);

  return res.status(200).json({ emails });
}

// ── Google Calendar ───────────────────────────────────────────────
const FINANCE_KEYWORDS = [
  'earnings', 'dividend', 'tax', 'payment', 'bill', 'invoice', 'salary',
  'budget', 'invest', 'stock', 'crypto', 'irs', 'deadline', 'filing',
  'bank', 'transfer', 'mortgage', 'rent', 'insurance', 'subscription',
];

function isFinancial(event) {
  const text = `${event.summary || ''} ${event.description || ''}`.toLowerCase();
  return FINANCE_KEYWORDS.some(k => text.includes(k));
}

async function handleGcal(req, res) {
  if (!process.env.OWNER_GCAL_REFRESH_TOKEN)
    return res.status(503).json({ error: 'Google Calendar not connected' });

  const token = await getToken(process.env.OWNER_GCAL_REFRESH_TOKEN);
  const now = new Date().toISOString();
  const in60Days = new Date(Date.now() + 60 * 86400000).toISOString();
  const params = new URLSearchParams({
    timeMin: now, timeMax: in60Days, maxResults: '100',
    singleEvents: 'true', orderBy: 'startTime',
    fields: 'items(id,summary,description,start,end,location)',
  });
  const calRes = await fetch(`${GCAL_BASE}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!calRes.ok) throw new Error(`Calendar API error ${calRes.status}`);
  const cal = await calRes.json();
  const events = (cal.items || []).filter(isFinancial).map(e => ({
    id: e.id, title: e.summary,
    date: e.start?.date || e.start?.dateTime,
    endDate: e.end?.date || e.end?.dateTime,
    description: e.description?.slice(0, 200),
  }));
  return res.status(200).json({ events });
}

// ── Google Sheets ─────────────────────────────────────────────────
const SHEET_NAME_RE  = /^[\w\s]{1,100}$/;
const SHEET_RANGE_RE = /^[A-Z]{1,3}[1-9]\d*:[A-Z]{1,3}[1-9]\d*$/;

async function handleGsheets(req, res) {
  const spreadsheetId = process.env.OWNER_SHEETS_ID;
  if (!spreadsheetId || !process.env.OWNER_GSHEETS_REFRESH_TOKEN)
    return res.status(503).json({ error: 'Google Sheets not configured' });

  const token   = await getToken(process.env.OWNER_GSHEETS_REFRESH_TOKEN);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    const sheet = req.query?.sheet || 'Sheet1';
    const range = req.query?.range || 'A1:Z1000';
    if (!SHEET_NAME_RE.test(sheet))  return res.status(400).json({ error: 'Invalid sheet name' });
    if (!SHEET_RANGE_RE.test(range)) return res.status(400).json({ error: 'Invalid range' });
    const rangeEncoded = encodeURIComponent(`${sheet}!${range}`);
    const sheetRes = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${rangeEncoded}?valueRenderOption=UNFORMATTED_VALUE`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (!sheetRes.ok) throw new Error(`Sheets read error ${sheetRes.status}`);
    const data = await sheetRes.json();
    return res.status(200).json({ values: data.values || [], range: data.range });
  }

  if (req.method === 'POST') {
    const { sheet = 'Sheet1', values } = req.body || {};
    if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be an array of rows' });
    const rangeEncoded = encodeURIComponent(`${sheet}!A1`);
    const appendRes = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${rangeEncoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers, body: JSON.stringify({ values }), signal: AbortSignal.timeout(10000) }
    );
    if (!appendRes.ok) throw new Error(`Sheets append error ${appendRes.status}`);
    const result = await appendRes.json();
    return res.status(200).json({ updatedRange: result.updates?.updatedRange });
  }

  return res.status(405).json({ error: 'GET or POST only' });
}

// ── YouTube ───────────────────────────────────────────────────────
async function ytFetch(path, token) {
  let r = await fetch(`${YT_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 401) {
    const newToken = await getToken(process.env.OWNER_YOUTUBE_REFRESH_TOKEN || '');
    r = await fetch(`${YT_BASE}${path}`, {
      headers: { Authorization: `Bearer ${newToken}` },
      signal: AbortSignal.timeout(10000),
    });
  }
  if (!r.ok) throw new Error(`YouTube API error ${r.status}`);
  return r.json();
}

async function handleYoutube(req, res) {
  if (!process.env.OWNER_YOUTUBE_REFRESH_TOKEN)
    return res.status(503).json({ error: 'YouTube account not connected' });

  const token    = await getToken(process.env.OWNER_YOUTUBE_REFRESH_TOKEN);
  const resource = req.query?.resource || 'subscriptions';
  let data;

  if (resource === 'liked') {
    data = await ytFetch('/videos?part=snippet&myRating=liked&maxResults=50&fields=items(id,snippet(title,channelTitle,description))', token);
  } else if (resource === 'subscriptions') {
    data = await ytFetch('/subscriptions?part=snippet&mine=true&maxResults=50&order=relevance&fields=items(snippet(title,resourceId,description))', token);
  } else if (resource === 'playlists') {
    data = await ytFetch('/playlists?part=snippet&mine=true&maxResults=50&fields=items(id,snippet(title,description))', token);
  } else {
    return res.status(400).json({ error: 'Unknown resource. Use: liked | subscriptions | playlists' });
  }

  return res.status(200).json(data);
}

// ── Main handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Cache-Control',          'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options',        'DENY');
  res.setHeader('Referrer-Policy',        'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!isOwnerSession(req))     return res.status(403).json({ error: 'Forbidden' });

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const { allowed, remaining, resetAt } = rateLimit(ip);
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT);
  res.setHeader('X-RateLimit-Remaining', remaining);
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil((resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const svc = (req.query?.svc || '').toLowerCase();

  try {
    if (svc === 'gmail')   return await handleGmail(req, res);
    if (svc === 'gcal')    return await handleGcal(req, res);
    if (svc === 'gsheets') return await handleGsheets(req, res);
    if (svc === 'youtube') return await handleYoutube(req, res);
    return res.status(400).json({ error: 'Unknown svc. Use: gmail | gcal | gsheets | youtube' });
  } catch (err) {
    console.error(`[google-data:${svc}]`, err.message);
    return res.status(502).json({ error: err.message });
  }
}
