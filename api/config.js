/**
 * FinAI — Public config endpoint
 * Returns non-sensitive environment configuration for the client.
 * If a Google ID token is supplied via Authorization header, also returns isOwner.
 */

const ipStore = new Map();
function checkRateLimit(id, maxReqs, windowMs) {
  const now = Date.now();
  let e = ipStore.get(id);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; ipStore.set(id, e); }
  e.count++;
  return { allowed: e.count <= maxReqs, remaining: Math.max(0, maxReqs - e.count), resetAt: e.resetAt };
}
setInterval(() => { const now = Date.now(); for (const [k,v] of ipStore) if (now > v.resetAt) ipStore.delete(k); }, 60_000);
const IP_LIMIT  = 30;
const WINDOW_MS = 60_000;

function getAllowedOrigin(req) {
  const origin  = req.headers['origin'] || '';
  const allowed = [
    process.env.ALLOWED_ORIGIN || '',
    'https://finai-topaz.vercel.app',
  ].filter(Boolean);
  if (!origin) return '';
  if (allowed.includes(origin)) return origin;
  if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return origin;
  return '';
}

async function verifyGoogleToken(token) {
  // JWT (id_token) has three dot-separated base64 parts; access tokens do not
  const isJwt = token.split('.').length === 3;
  const url = isJwt
    ? `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
    : `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const payload = await res.json();
  if (payload.error) return null;
  // For id_tokens, verify audience matches our client ID
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (isJwt && clientId && payload.aud !== clientId) return null;
  return payload;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = rawIp.split(',')[0].trim();
  const ipCheck  = checkRateLimit(clientIp, IP_LIMIT, WINDOW_MS);

  res.setHeader('X-RateLimit-Limit',     IP_LIMIT);
  res.setHeader('X-RateLimit-Remaining', ipCheck.remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(ipCheck.resetAt / 1000));

  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((ipCheck.resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  let isOwner = false;
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (idToken && process.env.OWNER_GOOGLE_ID) {
    try {
      const payload = await verifyGoogleToken(idToken);
      if (payload && payload.sub === process.env.OWNER_GOOGLE_ID) {
        isOwner = true;
      }
    } catch {
      // token verification failed — isOwner stays false
    }
  }

  return res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    isOwner,
  });
}
