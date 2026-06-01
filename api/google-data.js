/**
 * FinAI — Consolidated Google Data Proxy (owner-only)
 * Handles: gcal, gmail, gsheets, youtube
 * Route: GET|POST /api/google-data?svc=gcal|gmail|gsheets|youtube
 *
 * Merged from 4 separate files to stay within Vercel Hobby's 12-function limit.
 * Auth: requires valid owner session cookie (set by /api/owner-session).
 */

import { isOwnerSession } from './owner-session.js';

async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID     || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error('Token refresh failed: ' + res.status);
  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token in refresh response');
  return data.access_token;
}

// ── Google Calendar ───────────────────────────────────────────────────
const FINANCE_KEYWORDS = [
  'earnings','dividend','tax','payment','bill','invoice','salary',
  'budget','invest','stock','crypto','irs','deadline','filing',
  'bank','transfer','mortgage','rent','insurance','subscription',
];

function isFinancialEvent(event) {
  const text = `${event.summary || ''} ${event.description || ''}`.toLowerCase();
  return FINANCE_KEYWORDS.some(k => text.includes(k));
}

async function handleGcal(req, res) {
  if (!process.env.OWNER_GCAL_REFRESH_TOKEN)
    return res.status(503).json({ error: 'Google Calendar not connected' });

  const token   = await getAccessToken(process.env.OWNER_GCAL_REFRESH_TOKEN);
  const now     = new Date().toISOString();
  const in60    = new Date(Date.now() + 60 * 86400 * 1000).toISOString();
  const params  = new URLSearchParams({
    timeMin: now, timeMax: in60, maxResults: '100',
    singleEvents: 'true', orderBy: 'startTime',
    fields: 'items(id,summary,description,start,end,location)',
  });
  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!calRes.ok) throw new Error(`Calendar API error ${calRes.status}`);
  const cal    = await calRes.json();
  const events = (cal.items || []).filter(isFinancialEvent).map(e => ({
    id: e.id, title: e.summary,
    date: e.start?.date || e.start?.dateTime,
    endDate: e.end?.date || e.end?.dateTime,
    description: e.description?.slice(0, 200),
  }));
  return res.status(200).json({ events });
}

// ── Gmail ─────────────────────────────────────────────────────────────
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
  const token      = await getAccessToken(process.env.OWNER_GMAIL_REFRESH_TOKEN);
  const headers    = { Authorization: `Bearer ${token}` };
  const BASE       = 'https://gmail.googleapis.com/gmail/v1/users/me';

  const listRes = await fetch(
    `${BASE}/messages?q=${encodeURIComponent(FINANCE_QUERY)}&maxResults=${maxResults}&fields=messages(id)`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!listRes.ok) throw new Error(`Gmail list error ${listRes.status}`);
  const list = await listRes.json();
  if (!list.messages?.length) return res.status(200).json({ emails: [] });

  const results = await Promise.allSettled(
    list.messages.map(m =>
      fetch(
        `${BASE}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&fields=id,snippet,payload/headers`,
        { headers, signal: AbortSignal.timeout(5_000) },
      ).then(r => r.ok ? r.json() : null),
    ),
  );
  const emails = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => {
      const msg = r.value;
      const hdr = name => msg.payload?.headers?.find(h => h.name === name)?.value || '';
      return { id: msg.id, from: hdr('From'), subject: hdr('Subject'), date: hdr('Date'), snippet: msg.snippet };
    });
  return res.status(200).json({ emails });
}

// ── Google Sheets ─────────────────────────────────────────────────────
const SHEET_NAME_RE  = /^[A-Za-z0-9_ \-]{1,100}$/;
const RANGE_RE       = /^[A-Za-z0-9:!]{1,50}$/;

async function handleGsheets(req, res) {
  const spreadsheetId = process.env.OWNER_SHEETS_ID;
  if (!spreadsheetId || !process.env.OWNER_GSHEETS_REFRESH_TOKEN)
    return res.status(503).json({ error: 'Google Sheets not configured' });

  const token   = await getAccessToken(process.env.OWNER_GSHEETS_REFRESH_TOKEN);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const BASE    = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

  if (req.method === 'GET') {
    const sheet = (req.query?.sheet || 'Sheet1').slice(0, 100);
    const range = (req.query?.range || 'A1:Z1000').slice(0, 50);
    if (!SHEET_NAME_RE.test(sheet) || !RANGE_RE.test(range))
      return res.status(400).json({ error: 'Invalid sheet or range' });
    const rangeEncoded = encodeURIComponent(`${sheet}!${range}`);
    const sheetRes = await fetch(
      `${BASE}/values/${rangeEncoded}?valueRenderOption=UNFORMATTED_VALUE`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );
    if (!sheetRes.ok) throw new Error(`Sheets read error ${sheetRes.status}`);
    const data = await sheetRes.json();
    return res.status(200).json({ values: data.values || [], range: data.range });
  }

  if (req.method === 'POST') {
    const { sheet = 'Sheet1', values } = req.body || {};
    if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be an array of rows' });
    const safeSheet = String(sheet).slice(0, 100);
    if (!SHEET_NAME_RE.test(safeSheet)) return res.status(400).json({ error: 'Invalid sheet name' });
    const rangeEncoded = encodeURIComponent(`${safeSheet}!A1`);
    const appendRes = await fetch(
      `${BASE}/values/${rangeEncoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers, body: JSON.stringify({ values }), signal: AbortSignal.timeout(10_000) },
    );
    if (!appendRes.ok) throw new Error(`Sheets append error ${appendRes.status}`);
    const result = await appendRes.json();
    return res.status(200).json({ updatedRange: result.updates?.updatedRange });
  }

  return res.status(405).json({ error: 'GET or POST only' });
}

// ── YouTube ───────────────────────────────────────────────────────────
async function handleYoutube(req, res) {
  if (!process.env.OWNER_YOUTUBE_REFRESH_TOKEN)
    return res.status(503).json({ error: 'YouTube account not connected' });

  const resource = req.query?.resource || 'subscriptions';
  const BASE     = 'https://www.googleapis.com/youtube/v3';
  const token    = await getAccessToken(process.env.OWNER_YOUTUBE_REFRESH_TOKEN);

  const pathMap = {
    liked:         '/videos?part=snippet&myRating=liked&maxResults=50&fields=items(id,snippet(title,channelTitle,description))',
    subscriptions: '/subscriptions?part=snippet&mine=true&maxResults=50&order=relevance&fields=items(snippet(title,resourceId,description))',
    playlists:     '/playlists?part=snippet&mine=true&maxResults=50&fields=items(id,snippet(title,description))',
  };
  if (!pathMap[resource])
    return res.status(400).json({ error: 'Unknown resource. Use: liked | subscriptions | playlists' });

  const ytRes = await fetch(`${BASE}${pathMap[resource]}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(10_000),
  });

  if (ytRes.status === 401) {
    const newToken = await getAccessToken(process.env.OWNER_YOUTUBE_REFRESH_TOKEN);
    const retry    = await fetch(`${BASE}${pathMap[resource]}`, {
      headers: { Authorization: `Bearer ${newToken}` },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!retry.ok) throw new Error(`YouTube API error ${retry.status}`);
    return res.status(200).json(await retry.json());
  }

  if (!ytRes.ok) throw new Error(`YouTube API error ${ytRes.status}`);
  return res.status(200).json(await ytRes.json());
}

// ── Main handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!isOwnerSession(req)) return res.status(403).json({ error: 'Forbidden' });

  const svc = (req.query?.svc || '').toLowerCase();
  if (!svc) return res.status(400).json({ error: 'svc parameter required: gcal | gmail | gsheets | youtube' });

  try {
    switch (svc) {
      case 'gcal':    return await handleGcal(req, res);
      case 'gmail':   return await handleGmail(req, res);
      case 'gsheets': return await handleGsheets(req, res);
      case 'youtube': return await handleYoutube(req, res);
      default:        return res.status(400).json({ error: 'Unknown svc. Use: gcal | gmail | gsheets | youtube' });
    }
  } catch (err) {
    console.error(`[google-data] svc=${svc}`, err.message);
    return res.status(502).json({ error: err.message });
  }
}
