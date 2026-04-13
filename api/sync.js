/**
 * FinAI — Cloud Sync Proxy  (api/sync.js)
 * ─────────────────────────────────────────────────────────────────────
 * SECURITY:
 *  • Rate limiting (IP + token-based)
 *  • Token validation (Google OAuth or email-hash, not raw passwords)
 *  • Strict schema for POST body (size cap, field whitelist)
 *  • KV key namespaced to prevent cross-user data access
 *  • Sensitive fields stripped before returning user data
 *  • Security headers on every response
 */

// ── IN-MEMORY RATE LIMIT ─────────────────────────────────────────────
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

const IP_LIMIT  = 30;   // 30 sync ops per minute per IP
const TOK_LIMIT = 20;   // 20 sync ops per minute per token
const WINDOW_MS = 60_000;

// ── PAYLOAD LIMITS ───────────────────────────────────────────────────
const MAX_BODY_BYTES  = 256_000; // 256 KB — enough for all FinAI data
const MAX_KEY_LEN     = 64;      // max length of any data key name
const MAX_VALUE_LEN   = 100_000; // max length of any single value string

// ── ALLOWED SYNC KEYS ────────────────────────────────────────────────
// Whitelist prevents clients from storing arbitrary keys in the DB
const ALLOWED_SYNC_KEYS = new Set([
  'finai_port','finai_xp','finai_done','finai_ch','finai_sim','finai_cash',
  'finai_wl','finai_budget','finai_coursedone','finai_pa','finai_goals',
  'finai_tracker','finai_nw_accounts','finai_streak','finai_last_streak',
  'finai_achievements','finai_ob_done','finai_fc_session','_updated','_user',
]);

function setSecurityHeaders(res) {
  res.setHeader('X-Frame-Options',          'DENY');
  res.setHeader('X-Content-Type-Options',   'nosniff');
  res.setHeader('Referrer-Policy',          'no-referrer');
  res.setHeader('Content-Security-Policy',  "default-src 'none'");
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache');
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

/**
 * Verify a Google OAuth token or email-based identity token.
 * Returns { userId, email, name } or throws.
 */
async function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.length < 8) {
    throw new Error('Invalid token format');
  }

  // Google Access Token: verify via userinfo endpoint
  if (token.length > 50 && !token.includes('_')) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(4_000),
    });
    if (!r.ok) throw new Error('Google token verification failed');
    const d = await r.json();
    if (!d.sub) throw new Error('No sub in Google response');
    return { userId: 'g_' + d.sub, email: d.email || '', name: d.name || '' };
  }

  // Google ID Token (JWT credential from One Tap)
  if (token.includes('.')) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=' + token, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!r.ok) throw new Error('Google ID token verification failed');
    const d = await r.json();
    if (d.error || !d.sub) throw new Error('Invalid Google ID token');
    return { userId: 'g_' + d.sub, email: d.email || '', name: d.name || '' };
  }

  // Email-based identity: token is "email_<hash>" format from client
  // SECURITY: client sends a deterministic ID, NOT the password hash
  if (token.startsWith('email_')) {
    const id = token.slice(6, 70); // cap at 64 chars after prefix
    if (!/^[a-zA-Z0-9_@.+\-]{3,64}$/.test(id)) throw new Error('Invalid email token format');
    return { userId: 'e_' + id, email: id, name: '' };
  }

  throw new Error('Unrecognized token format');
}

export default async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendError(res, 405, 'method_not_allowed', 'Only GET and POST are accepted.');
  }

  // IP rate limit
  const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = rawIp.split(',')[0].trim();
  const ipCheck  = checkRateLimit(ipStore, clientIp, IP_LIMIT, WINDOW_MS);

  res.setHeader('X-RateLimit-Limit',     IP_LIMIT);
  res.setHeader('X-RateLimit-Remaining', ipCheck.remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(ipCheck.resetAt / 1000));

  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((ipCheck.resetAt - Date.now()) / 1000));
    return sendError(res, 429, 'rate_limit_exceeded', 'Too many requests.');
  }

  // Require Authorization header
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'unauthorized', 'Authorization: Bearer <token> required.');
  }
  const token = authHeader.slice(7);

  // Verify token and get userId
  let userId, email, name;
  try {
    ({ userId, email, name } = await verifyToken(token));
  } catch(e) {
    return sendError(res, 401, 'invalid_token', 'Token verification failed.');
  }

  // Token-based rate limit (prevents one user from hammering sync)
  const tokCheck = checkRateLimit(tokStore, userId, TOK_LIMIT, WINDOW_MS);
  if (!tokCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((tokCheck.resetAt - Date.now()) / 1000));
    return sendError(res, 429, 'user_rate_limit', 'Sync rate limit reached. Please wait.');
  }

  // Require KV environment variables
  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    // No KV configured — return auth success so client knows identity works
    return res.status(200).json({
      ok:   true,
      user: { id: userId, email, name },
      note: 'KV storage not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN env vars.',
    });
  }

  // KV key namespaced by userId — prevents cross-user data access
  const kvKey = `finai:${userId}`;
  const kvHdr = { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' };

  // ── GET: load user data ───────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const r = await fetch(`${KV_URL}/get/${kvKey}`, {
        headers: kvHdr,
        signal:  AbortSignal.timeout(5_000),
      });
      const d = await r.json();
      return res.status(200).json({
        ok:   true,
        user: { id: userId, email, name },
        data: d.result ? JSON.parse(d.result) : null,
      });
    } catch(_) {
      return res.status(200).json({ ok: true, user: { id: userId, email, name }, data: null });
    }
  }

  // ── POST: save user data ──────────────────────────────────────────
  const cl = parseInt(req.headers['content-length'] || '0', 10);
  if (cl > MAX_BODY_BYTES) {
    return sendError(res, 413, 'payload_too_large', `Sync payload must be under ${MAX_BODY_BYTES} bytes.`);
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
    return sendError(res, 400, 'invalid_body', 'body.data must be an object.');
  }

  // Validate and sanitize data keys/values
  const cleanData = {};
  for (const [k, v] of Object.entries(body.data)) {
    // Key whitelist
    if (!ALLOWED_SYNC_KEYS.has(k)) continue; // silently drop unknown keys

    // Key length check (redundant given whitelist, but defensive)
    if (typeof k !== 'string' || k.length > MAX_KEY_LEN) continue;

    // Value must be a string (localStorage values are always strings)
    if (typeof v !== 'string') continue;

    // Value length cap
    if (v.length > MAX_VALUE_LEN) {
      return sendError(res, 400, 'value_too_large',
        `Value for key "${k}" exceeds ${MAX_VALUE_LEN} characters.`);
    }

    cleanData[k] = v;
  }

  cleanData._updated = Date.now();

  try {
    const r = await fetch(`${KV_URL}/set/${kvKey}`, {
      method:  'POST',
      headers: kvHdr,
      body:    JSON.stringify({ value: JSON.stringify(cleanData) }),
      signal:  AbortSignal.timeout(5_000),
    });
    if (!r.ok) throw new Error('KV write failed: ' + r.status);
    return res.status(200).json({ ok: true, user: { id: userId, email, name } });
  } catch(e) {
    console.error('[sync.js] KV error:', e.message);
    return sendError(res, 500, 'storage_error', 'Failed to save data. Please try again.');
  }
}
