/**
 * Homework AI — Session management
 * Stores the user's OAuth tokens (access + refresh) in a server-side session,
 * identified by an HttpOnly cookie. No tokens are ever sent to the browser.
 *
 * POST /api/session  — called by the OAuth callback to establish a session
 * DELETE /api/session — sign out
 * GET /api/session   — check if a session exists and return basic profile info
 */

import { createHash, randomBytes } from 'crypto';

const sessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (refresh token keeps it alive)
export const COOKIE_NAME = 'hw_session';

// Prune expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (now > v.expiresAt) sessions.delete(k);
}, 10 * 60 * 1000);

function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => {
      const idx = c.indexOf('=');
      if (idx < 0) return [c.trim(), ''];
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1).trim())];
    })
  );
}

/** Create a new session storing tokens. Returns the raw session token to set as cookie. */
export function createSession({ accessToken, refreshToken, expiresIn, email, name, picture }) {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  sessions.set(hash, {
    accessToken,
    refreshToken,
    tokenExpiresAt: Date.now() + (expiresIn || 3600) * 1000,
    email,
    name,
    picture,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

/** Get the full session data for an incoming request. Returns null if no valid session. */
export function getSession(req) {
  const cookies = parseCookies(req.headers['cookie'] || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  const session = sessions.get(hash);
  if (!session) return null;
  if (Date.now() > session.expiresAt) { sessions.delete(hash); return null; }
  return session;
}

/** Update the access token in an existing session (after token refresh). */
export function updateSessionToken(req, accessToken, expiresIn) {
  const cookies = parseCookies(req.headers['cookie'] || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return;
  const hash = createHash('sha256').update(token).digest('hex');
  const session = sessions.get(hash);
  if (!session) return;
  session.accessToken = accessToken;
  session.tokenExpiresAt = Date.now() + (expiresIn || 3600) * 1000;
}

/** Returns true if the request has a valid session. */
export function isSession(req) {
  return getSession(req) !== null;
}

/** Get a fresh access token, refreshing if expired. */
export async function getFreshAccessToken(req) {
  const session = getSession(req);
  if (!session) throw new Error('No session');

  if (Date.now() < session.tokenExpiresAt - 60_000) {
    return session.accessToken;
  }

  // Refresh the token
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error('Token refresh failed');
  const data = await r.json();
  updateSessionToken(req, data.access_token, data.expires_in);
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const session = getSession(req);
    if (!session) return res.status(401).json({ authenticated: false });
    return res.status(200).json({
      authenticated: true,
      email: session.email,
      name: session.name,
      picture: session.picture,
    });
  }

  if (req.method === 'DELETE') {
    const cookies = parseCookies(req.headers['cookie'] || '');
    const token = cookies[COOKIE_NAME];
    if (token) {
      const hash = createHash('sha256').update(token).digest('hex');
      sessions.delete(hash);
    }
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
