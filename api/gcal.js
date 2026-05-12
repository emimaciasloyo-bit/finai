/**
 * FinAI — Google Calendar Proxy (owner-only)
 * Fetches upcoming events that are financially relevant:
 * earnings calls, bill due dates, tax deadlines, investment-related reminders.
 *
 * Auth: requires valid owner session cookie (set by /api/owner-session).
 * Env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OWNER_GCAL_REFRESH_TOKEN
 */

import { isOwnerSession } from './owner-session.js';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

const FINANCE_KEYWORDS = [
  'earnings', 'dividend', 'tax', 'payment', 'bill', 'invoice', 'salary',
  'budget', 'invest', 'stock', 'crypto', 'irs', 'deadline', 'filing',
  'bank', 'transfer', 'mortgage', 'rent', 'insurance', 'subscription',
];

function isFinancial(event) {
  const text = `${event.summary || ''} ${event.description || ''}`.toLowerCase();
  return FINANCE_KEYWORDS.some(k => text.includes(k));
}

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: process.env.OWNER_GCAL_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Calendar token refresh failed');
  const data = await res.json();
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (!isOwnerSession(req)) return res.status(403).json({ error: 'Forbidden' });

  if (!process.env.OWNER_GCAL_REFRESH_TOKEN) {
    return res.status(503).json({ error: 'Google Calendar not connected' });
  }

  try {
    const token = await getAccessToken();

    const now = new Date().toISOString();
    const in60Days = new Date(Date.now() + 60 * 86400 * 1000).toISOString();

    const params = new URLSearchParams({
      timeMin: now,
      timeMax: in60Days,
      maxResults: '100',
      singleEvents: 'true',
      orderBy: 'startTime',
      fields: 'items(id,summary,description,start,end,location)',
    });

    const calRes = await fetch(`${GCAL_BASE}/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!calRes.ok) throw new Error(`Calendar API error ${calRes.status}`);
    const cal = await calRes.json();

    const events = (cal.items || [])
      .filter(isFinancial)
      .map(e => ({
        id: e.id,
        title: e.summary,
        date: e.start?.date || e.start?.dateTime,
        endDate: e.end?.date || e.end?.dateTime,
        description: e.description?.slice(0, 200),
      }));

    return res.status(200).json({ events });
  } catch (err) {
    console.error('[gcal]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
