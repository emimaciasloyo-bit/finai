/**
 * FinAI — Public config endpoint
 * Returns non-sensitive environment configuration for the client.
 * If a Google ID token is supplied via Authorization header, also returns isOwner.
 */

function getAllowedOrigin(req) {
  const origin  = req.headers['origin'] || '';
  const allowed = [process.env.ALLOWED_ORIGIN || '', 'https://finai-topaz.vercel.app'].filter(Boolean);
  if (!origin) return 'same-origin';
  if (allowed.some(a => origin.startsWith(a))) return origin;
  if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return origin;
  return null;
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
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed.' });

  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (allowedOrigin !== 'same-origin') {
    res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

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
