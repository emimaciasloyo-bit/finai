/**
 * FinAI — Owner session management
 * POST: verify Google ID token, set HttpOnly session cookie if owner
 * DELETE: clear the session cookie
 *
 * The HttpOnly cookie means even if XSS runs in the browser, it cannot
 * read or steal the owner session token.
 */

import { createHash, randomBytes } from 'crypto';

// In-memory session store (survives across requests in the same serverless instance).
// Sessions expire after 4 hours. Vercel spins down idle functions, so this is
// intentionally lightweight — owner simply re-authenticates on next visit.
const sessions = new Map();
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const COOKIE_NAME = 'finai_owner';

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (now > v.expiresAt) sessions.delete(k);
}, 5 * 60 * 1000);

async function verifyGoogleToken(token) {
  const isJwt = token.split('.').length === 3;
  const url = isJwt
    ? `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
    : `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const payload = await res.json();
  if (payload.error) return null;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (isJwt && clientId && payload.aud !== clientId) return null;
  return payload;
}

function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
}

export default async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || '';
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // DELETE — sign out: clear cookie
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST or DELETE only' });

  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing Authorization header' });

  if (!process.env.OWNER_GOOGLE_ID) return res.status(503).json({ error: 'Owner mode not configured' });

  let payload;
  try {
    payload = await verifyGoogleToken(idToken);
  } catch {
    return res.status(401).json({ error: 'Token verification failed' });
  }

  if (!payload || payload.sub !== process.env.OWNER_GOOGLE_ID) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Issue a session token
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  // Store a hash of the token, not the token itself
  sessions.set(createHash('sha256').update(token).digest('hex'), { expiresAt });

  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
  return res.status(200).json({ ok: true, expiresAt });
}

/**
 * Utility: verify the owner session cookie from an incoming request.
 * Returns true if the request carries a valid owner session.
 */
export function isOwnerSession(req) {
  const cookies = parseCookies(req.headers['cookie'] || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const hash = createHash('sha256').update(token).digest('hex');
  const session = sessions.get(hash);
  if (!session) return false;
  if (Date.now() > session.expiresAt) { sessions.delete(hash); return false; }
  return true;
}
