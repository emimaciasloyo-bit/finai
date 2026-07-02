/**
 * FinAI — Public config endpoint
 * Returns non-sensitive environment configuration for the client.
 * If a Google ID token is supplied via Authorization header, also returns isOwner.
 */

async function verifyGoogleToken(token) {
  // JWT (id_token) has three dot-separated base64 parts; access tokens do not
  const isJwt = token.split('.').length === 3;
  const url = isJwt
    ? `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
    : `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const payload = await res.json();
  if (payload.error) return null;
  // Verify the token was issued to OUR OAuth client for both id_tokens and
  // access tokens (aud / azp). Fail closed if the client ID is not configured
  // so a foreign token can never be mistaken for the owner's.
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return null;
  const aud = payload.aud || payload.azp;
  if (aud !== clientId) return null;
  return payload;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  // Only advertise CORS access to explicitly allowed origins. Same-origin
  // requests (the app itself) do not need an ACAO header, so no wildcard.
  const origin = req.headers['origin'] || '';
  const allowed = [process.env.ALLOWED_ORIGIN || '', 'https://finai-topaz.vercel.app'].filter(Boolean);
  if (origin && allowed.some(a => origin.startsWith(a))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');

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
