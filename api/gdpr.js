/**
 * FinAI — GDPR Data Export & Deletion  (api/gdpr.js)
 *
 * GET  /api/gdpr  — Export all user data as JSON (requires Bearer token)
 * DELETE /api/gdpr — Delete all user data from KV (requires Bearer token)
 *
 * SECURITY: same token verification as sync.js + rate limiting
 */

const ipStore  = new Map();
const tokStore = new Map();

function checkRateLimit(store, id, maxReqs, windowMs) {
  const now = Date.now();
  let e = store.get(id);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; store.set(id, e); }
  e.count++;
  return { allowed: e.count <= maxReqs, remaining: Math.max(0, maxReqs - e.count), resetAt: e.resetAt };
}

setInterval(() => {
  const now = Date.now();
  for (const [k,v] of ipStore)  if (now > v.resetAt) ipStore.delete(k);
  for (const [k,v] of tokStore) if (now > v.resetAt) tokStore.delete(k);
}, 60_000);

function getAllowedOrigin(req) {
  const origin = req.headers['origin'] || '';
  const allowed = [process.env.ALLOWED_ORIGIN || '', 'https://finai-topaz.vercel.app'].filter(Boolean);
  if (!origin) return 'same-origin';
  if (allowed.some(a => origin.startsWith(a))) return origin;
  if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return origin;
  return null;
}

function setSecurityHeaders(res, allowedOrigin) {
  res.setHeader('X-Frame-Options',           'DENY');
  res.setHeader('X-Content-Type-Options',    'nosniff');
  res.setHeader('Referrer-Policy',           'no-referrer');
  res.setHeader('Content-Security-Policy',   "default-src 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Cache-Control',             'no-store, no-cache, private');
  if (allowedOrigin && allowedOrigin !== 'same-origin') {
    res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

async function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.length < 8) throw new Error('Invalid token format');

  if (token.length > 50 && !token.includes('_')) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(4_000),
    });
    if (!r.ok) throw new Error('Google token verification failed');
    const d = await r.json();
    if (!d.sub) throw new Error('No sub in Google response');
    return { userId: 'g_' + d.sub, email: d.email || '' };
  }

  if (token.includes('.')) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=' + token, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!r.ok) throw new Error('Google ID token verification failed');
    const d = await r.json();
    if (d.error || !d.sub) throw new Error('Invalid Google ID token');
    return { userId: 'g_' + d.sub, email: d.email || '' };
  }

  if (token.startsWith('email_')) {
    const email = token.slice(6, 70);
    if (!/^[a-zA-Z0-9_@.+\-]{3,64}$/.test(email)) throw new Error('Invalid email token format');
    const secret = process.env.SYNC_HMAC_SECRET;
    if (!secret) throw new Error('Email auth not configured on server');
    const { createHmac } = await import('node:crypto');
    const hash = createHmac('sha256', secret).update(email.toLowerCase()).digest('hex').slice(0, 32);
    return { userId: 'e_' + hash, email };
  }

  throw new Error('Unrecognized token format');
}

export default async function handler(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: { code: 'forbidden_origin', message: 'Origin not allowed.' } });

  setSecurityHeaders(res, allowedOrigin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    return sendError(res, 405, 'method_not_allowed', 'Only GET and DELETE are accepted.');
  }

  const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = rawIp.split(',')[0].trim();
  const ipCheck  = checkRateLimit(ipStore, clientIp, 10, 60_000);

  res.setHeader('X-RateLimit-Limit',     10);
  res.setHeader('X-RateLimit-Remaining', ipCheck.remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(ipCheck.resetAt / 1000));

  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((ipCheck.resetAt - Date.now()) / 1000));
    return sendError(res, 429, 'rate_limit_exceeded', 'Too many GDPR requests.');
  }

  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'unauthorized', 'Authorization: Bearer <token> required.');
  }
  const token = authHeader.slice(7);

  let userId, email;
  try {
    ({ userId, email } = await verifyToken(token));
  } catch(e) {
    return sendError(res, 401, 'invalid_token', 'Token verification failed.');
  }

  const tokCheck = checkRateLimit(tokStore, userId, 5, 60_000);
  if (!tokCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((tokCheck.resetAt - Date.now()) / 1000));
    return sendError(res, 429, 'user_rate_limit', 'Too many GDPR requests for this user.');
  }

  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    return sendError(res, 503, 'kv_unavailable', 'Cloud storage not configured.');
  }

  const kvKey = `finai:${userId}`;
  const kvHdr = { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' };

  // ── GET: export all user data ─────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const r = await fetch(`${KV_URL}/get/${kvKey}`, { headers: kvHdr, signal: AbortSignal.timeout(5_000) });
      const d = await r.json();
      const userData = d.result ? JSON.parse(d.result) : {};

      res.setHeader('Content-Disposition', 'attachment; filename="finai-data-export.json"');
      return res.status(200).json({
        exported_at: new Date().toISOString(),
        user: { id: userId, email },
        data: userData,
      });
    } catch(e) {
      console.error('[gdpr.js] export error:', e.message);
      return sendError(res, 500, 'export_error', 'Failed to export data.');
    }
  }

  // ── DELETE: erase all user data ───────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      const r = await fetch(`${KV_URL}/del/${kvKey}`, {
        method: 'POST',
        headers: kvHdr,
        signal: AbortSignal.timeout(5_000),
      });
      if (!r.ok) throw new Error('KV delete failed: ' + r.status);
      console.log('[gdpr.js] deleted data for userId:', userId);
      return res.status(200).json({ ok: true, message: 'All cloud data deleted. Your local data is not affected.' });
    } catch(e) {
      console.error('[gdpr.js] delete error:', e.message);
      return sendError(res, 500, 'delete_error', 'Failed to delete data.');
    }
  }
}
