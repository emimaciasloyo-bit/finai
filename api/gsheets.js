/**
 * FinAI — Google Sheets Proxy (owner-only)
 * Read and append rows to the owner's personal finance spreadsheet.
 *
 * GET  ?sheet=Sheet1&range=A1:Z100  — read cells
 * POST { sheet, values: [[...]] }   — append a row
 *
 * Auth: requires valid owner session cookie (set by /api/owner-session).
 * Env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OWNER_GSHEETS_REFRESH_TOKEN, OWNER_SHEETS_ID
 */

import { isOwnerSession } from './owner-session.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Sheet name: letters, digits, spaces, hyphens, underscores — up to 100 chars
const SHEET_NAME_RE = /^[A-Za-z0-9 _\-]{1,100}$/;
// Range: standard A1 notation e.g. A1, A1:Z1000, A:Z
const RANGE_RE      = /^[A-Z]{1,3}[0-9]{0,7}(:[A-Z]{1,3}[0-9]{0,7})?$/;

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: process.env.OWNER_GSHEETS_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Sheets token refresh failed');
  const data = await res.json();
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!isOwnerSession(req)) return res.status(403).json({ error: 'Forbidden' });

  const spreadsheetId = process.env.OWNER_SHEETS_ID;
  if (!spreadsheetId || !process.env.OWNER_GSHEETS_REFRESH_TOKEN) {
    return res.status(503).json({ error: 'Google Sheets not configured' });
  }

  try {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    if (req.method === 'GET') {
      const sheet = req.query?.sheet || 'Sheet1';
      const range = req.query?.range || 'A1:Z1000';
      if (!SHEET_NAME_RE.test(sheet)) return res.status(400).json({ error: 'Invalid sheet name' });
      if (!RANGE_RE.test(range.toUpperCase())) return res.status(400).json({ error: 'Invalid range format' });
      const rangeEncoded = encodeURIComponent(`${sheet}!${range}`);

      const sheetRes = await fetch(
        `${SHEETS_BASE}/${spreadsheetId}/values/${rangeEncoded}?valueRenderOption=UNFORMATTED_VALUE`,
        { headers }
      );
      if (!sheetRes.ok) throw new Error(`Sheets read error ${sheetRes.status}`);
      const data = await sheetRes.json();
      return res.status(200).json({ values: data.values || [], range: data.range });
    }

    if (req.method === 'POST') {
      const { sheet = 'Sheet1', values } = req.body || {};
      if (!SHEET_NAME_RE.test(sheet)) return res.status(400).json({ error: 'Invalid sheet name' });
      if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be an array of rows' });

      const rangeEncoded = encodeURIComponent(`${sheet}!A1`);
      const appendRes = await fetch(
        `${SHEETS_BASE}/${spreadsheetId}/values/${rangeEncoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ values }),
        }
      );
      if (!appendRes.ok) throw new Error(`Sheets append error ${appendRes.status}`);
      const result = await appendRes.json();
      return res.status(200).json({ updatedRange: result.updates?.updatedRange });
    }

    return res.status(405).json({ error: 'GET or POST only' });
  } catch (err) {
    console.error('[gsheets]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
