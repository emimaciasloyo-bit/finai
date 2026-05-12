/**
 * FinAI — Gmail Proxy (owner-only)
 * Fetches financial emails: bank statements, trade confirmations, tax docs, bills.
 * Returns a lightweight summary (subject, from, date, snippet) — never full body.
 *
 * Auth: requires valid owner session cookie (set by /api/owner-session).
 * Env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OWNER_GMAIL_REFRESH_TOKEN
 */

import { isOwnerSession } from './owner-session.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Financial email keywords for the Gmail search query
const FINANCE_QUERY = [
  'from:no-reply@chase.com OR from:service@paypal.com',
  'OR subject:(statement OR "trade confirmation" OR "account summary")',
  'OR subject:(dividend OR deposit OR withdrawal OR "tax document" OR "1099" OR "W-2")',
  'OR subject:(invoice OR receipt OR payment OR bill)',
].join(' ');

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: process.env.OWNER_GMAIL_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Gmail token refresh failed');
  const data = await res.json();
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (!isOwnerSession(req)) return res.status(403).json({ error: 'Forbidden' });

  if (!process.env.OWNER_GMAIL_REFRESH_TOKEN) {
    return res.status(503).json({ error: 'Gmail not connected' });
  }

  const maxResults = Math.min(parseInt(req.query?.max || '20', 10), 50);

  try {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    // Search for financial emails
    const listRes = await fetch(
      `${GMAIL_BASE}/messages?q=${encodeURIComponent(FINANCE_QUERY)}&maxResults=${maxResults}&fields=messages(id)`,
      { headers }
    );
    if (!listRes.ok) throw new Error(`Gmail list error ${listRes.status}`);
    const list = await listRes.json();

    if (!list.messages?.length) return res.status(200).json({ emails: [] });

    // Fetch snippet + headers for each message (no full body)
    const emails = await Promise.all(
      list.messages.map(async m => {
        const msgRes = await fetch(
          `${GMAIL_BASE}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&fields=id,snippet,payload/headers`,
          { headers }
        );
        if (!msgRes.ok) return null;
        const msg = await msgRes.json();
        const hdr = name => msg.payload?.headers?.find(h => h.name === name)?.value || '';
        return {
          id: msg.id,
          from: hdr('From'),
          subject: hdr('Subject'),
          date: hdr('Date'),
          snippet: msg.snippet,
        };
      })
    );

    return res.status(200).json({ emails: emails.filter(Boolean) });
  } catch (err) {
    console.error('[gmail]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
