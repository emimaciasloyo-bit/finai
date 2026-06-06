/**
 * FinAI — Google Data Proxy  (api/google-data.js)
 * ─────────────────────────────────────────────────────────────────────
 * Consolidates gmail, gcal, gsheets, and youtube-account into one
 * serverless function to stay within Vercel Hobby plan's 12-function cap.
 *
 * Route via ?svc=gmail | gcal | gsheets | youtube
 *
 * Auth: requires valid owner session cookie (set by /api/owner-session).
 * SECURITY: CORS locked to app origin, full security headers, input validation.
 */

import { isOwnerSession } from './owner-session.js';

// ── SECURITY HELPERS ─────────────────────────────────────────────────

function getAllowedOrigin(req) {
  const origin  = req.headers['origin'] || '';
  const allowed = [process.env.ALLOWED_ORIGIN || '', 'https://finai-topaz.vercel.app'].filter(Boolean);
  if (!origin) return 'same-origin';
  if (allowed.some(a => origin.startsWith(a))) return origin;
  if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return origin;
  return null;
}

function setSecurityHeaders(res, allowedOrigin, methods = 'GET') {
  res.setHeader('Cache-Control',             'no-store, private');
  res.setHeader('X-Content-Type-Options',    'nosniff');
  res.setHeader('X-Frame-Options',           'DENY');
  res.setHeader('Referrer-Policy',           'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  if (allowedOrigin && allowedOrigin !== 'same-origin') {
    res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', `${methods}, OPTIONS`);
    res.setHeader('Vary', 'Origin');
  }
}

// ── SHARED GOOGLE OAUTH HELPER ────────────────────────────────────────

async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID     || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error('Google token refresh failed');
  const data = await res.json();
  return data.access_token;
}

// ── GMAIL ─────────────────────────────────────────────────────────────

const FINANCE_QUERY = [
  'from:no-reply@chase.com OR from:service@paypal.com',
  'OR subject:(statement OR "trade confirmation" OR "account summary")',
  'OR subject:(dividend OR deposit OR withdrawal OR "tax document" OR "1099" OR "W-2")',
  'OR subject:(invoice OR receipt OR payment OR bill)',
].join(' ');

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function handleGmail(req, res) {
  if (!process.env.OWNER_GMAIL_REFRESH_TOKEN) {
    return res.status(503).json({ error: 'Gmail not connected' });
  }

  const maxResults = Math.min(parseInt(req.query?.max || '20', 10), 50);
  const token      = await getAccessToken(process.env.OWNER_GMAIL_REFRESH_TOKEN);
  const headers    = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(
    `${GMAIL_BASE}/messages?q=${encodeURIComponent(FINANCE_QUERY)}&maxResults=${maxResults}&fields=messages(id)`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!listRes.ok) throw new Error(`Gmail list error ${listRes.status}`);
  const list = await listRes.json();

  if (!list.messages?.length) return res.status(200).json({ emails: [] });

  const results = await Promise.allSettled(
    list.messages.map(async m => {
      const msgRes = await fetch(
        `${GMAIL_BASE}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&fields=id,snippet,payload/headers`,
        { headers, signal: AbortSignal.timeout(6_000) },
      );
      if (!msgRes.ok) return null;
      const msg = await msgRes.json();
      const hdr = name => msg.payload?.headers?.find(h => h.name === name)?.value || '';
      return { id: msg.id, from: hdr('From'), subject: hdr('Subject'), date: hdr('Date'), snippet: msg.snippet };
    }),
  );

  const emails = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  return res.status(200).json({ emails });
}

// ── GOOGLE CALENDAR ───────────────────────────────────────────────────

const FINANCE_KEYWORDS = [
  'earnings', 'dividend', 'tax', 'payment', 'bill', 'invoice', 'salary',
  'budget', 'invest', 'stock', 'crypto', 'irs', 'deadline', 'filing',
  'bank', 'transfer', 'mortgage', 'rent', 'insurance', 'subscription',
];

async function handleGcal(req, res) {
  if (!process.env.OWNER_GCAL_REFRESH_TOKEN) {
    return res.status(503).json({ error: 'Google Calendar not connected' });
  }

  const token = await getAccessToken(process.env.OWNER_GCAL_REFRESH_TOKEN);

  const now       = new Date().toISOString();
  const in60Days  = new Date(Date.now() + 60 * 86400 * 1000).toISOString();
  const params    = new URLSearchParams({
    timeMin: now, timeMax: in60Days, maxResults: '100',
    singleEvents: 'true', orderBy: 'startTime',
    fields: 'items(id,summary,description,start,end)',
  });

  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!calRes.ok) throw new Error(`Calendar API error ${calRes.status}`);
  const cal = await calRes.json();

  const events = (cal.items || [])
    .filter(e => {
      const text = `${e.summary || ''} ${e.description || ''}`.toLowerCase();
      return FINANCE_KEYWORDS.some(k => text.includes(k));
    })
    .map(e => ({
      id:          e.id,
      title:       e.summary,
      date:        e.start?.date || e.start?.dateTime,
      endDate:     e.end?.date   || e.end?.dateTime,
      description: e.description?.slice(0, 200),
    }));

  return res.status(200).json({ events });
}

// ── GOOGLE SHEETS ─────────────────────────────────────────────────────

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_NAME_RE  = /^[A-Za-z0-9 _\-\.]{1,100}$/;
const SHEET_RANGE_RE = /^[A-Z]{1,3}[1-9][0-9]{0,6}(:[A-Z]{1,3}[1-9][0-9]{0,6})?$/;

async function handleGsheets(req, res) {
  const spreadsheetId = process.env.OWNER_SHEETS_ID;
  if (!spreadsheetId || !process.env.OWNER_GSHEETS_REFRESH_TOKEN) {
    return res.status(503).json({ error: 'Google Sheets not configured' });
  }

  const token   = await getAccessToken(process.env.OWNER_GSHEETS_REFRESH_TOKEN);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    const rawSheet = req.query?.sheet || 'Sheet1';
    const rawRange = (req.query?.range || 'A1:Z1000').toUpperCase();
    if (!SHEET_NAME_RE.test(rawSheet))   return res.status(400).json({ error: 'Invalid sheet name.' });
    if (!SHEET_RANGE_RE.test(rawRange))  return res.status(400).json({ error: 'Invalid range format. Example: A1:Z1000' });

    const rangeEncoded = encodeURIComponent(`${rawSheet}!${rawRange}`);
    const sheetRes = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${rangeEncoded}?valueRenderOption=UNFORMATTED_VALUE`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );
    if (!sheetRes.ok) throw new Error(`Sheets read error ${sheetRes.status}`);
    const data = await sheetRes.json();
    return res.status(200).json({ values: data.values || [], range: data.range });
  }

  if (req.method === 'POST') {
    const { sheet: rawSheet = 'Sheet1', values } = req.body || {};
    if (!Array.isArray(values))        return res.status(400).json({ error: 'values must be an array of rows' });
    if (!SHEET_NAME_RE.test(rawSheet)) return res.status(400).json({ error: 'Invalid sheet name.' });

    const rangeEncoded = encodeURIComponent(`${rawSheet}!A1`);
    const appendRes = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${rangeEncoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers, body: JSON.stringify({ values }), signal: AbortSignal.timeout(10_000) },
    );
    if (!appendRes.ok) throw new Error(`Sheets append error ${appendRes.status}`);
    const result = await appendRes.json();
    return res.status(200).json({ updatedRange: result.updates?.updatedRange });
  }

  return res.status(405).json({ error: 'GET or POST only for gsheets' });
}

// ── YOUTUBE ACCOUNT ───────────────────────────────────────────────────

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

async function ytFetch(path, token) {
  const r = await fetch(`${YT_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(10_000),
  });
  if (r.status === 401) {
    const newToken = await getAccessToken(process.env.OWNER_YOUTUBE_REFRESH_TOKEN);
    const retry = await fetch(`${YT_BASE}${path}`, {
      headers: { Authorization: `Bearer ${newToken}` },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!retry.ok) throw new Error(`YouTube API error ${retry.status}`);
    return retry.json();
  }
  if (!r.ok) throw new Error(`YouTube API error ${r.status}`);
  return r.json();
}

async function handleYoutube(req, res) {
  if (!process.env.OWNER_YOUTUBE_REFRESH_TOKEN) {
    return res.status(503).json({ error: 'YouTube account not connected' });
  }

  const token    = await getAccessToken(process.env.OWNER_YOUTUBE_REFRESH_TOKEN);
  const resource = req.query?.resource || 'subscriptions';
  let   data;

  if (resource === 'liked') {
    data = await ytFetch(
      '/videos?part=snippet&myRating=liked&maxResults=50&fields=items(id,snippet(title,channelTitle,description))',
      token,
    );
  } else if (resource === 'subscriptions') {
    data = await ytFetch(
      '/subscriptions?part=snippet&mine=true&maxResults=50&order=relevance&fields=items(snippet(title,resourceId,description))',
      token,
    );
  } else if (resource === 'playlists') {
    data = await ytFetch(
      '/playlists?part=snippet&mine=true&maxResults=50&fields=items(id,snippet(title,description))',
      token,
    );
  } else {
    return res.status(400).json({ error: 'Unknown resource. Use: liked | subscriptions | playlists' });
  }

  return res.status(200).json(data);
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────

export default async function handler(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) {
    return res.status(403).json({ error: { code: 'forbidden_origin', message: 'Origin not allowed.' } });
  }

  const svc     = (req.query?.svc || '').toLowerCase();
  const methods = svc === 'gsheets' ? 'GET, POST' : 'GET';
  setSecurityHeaders(res, allowedOrigin, methods);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!isOwnerSession(req)) return res.status(403).json({ error: 'Forbidden' });

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
