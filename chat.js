/**
 * FinAI — Anthropic API Proxy  (api/chat.js)
 * ─────────────────────────────────────────────────────────────────────
 * SECURITY HARDENING (OWASP API Security Top 10)
 *
 *  API1  Broken Object Level Auth   → n/a (no user objects)
 *  API2  Broken Auth                → API key server-side only, never client
 *  API3  Broken Object Property     → strict schema, reject unknown fields
 *  API4  Unrestricted Resource      → max_tokens cap, message count cap, body-size cap
 *  API5  Broken Function Level Auth → POST-only, OPTIONS for preflight
 *  API6  Unrestricted Data Access   → model whitelist
 *  API7  Security Misconfiguration  → security headers on every response
 *  API8  Injection                  → message content length-capped
 *  API9  Improper Inventory         → single versioned endpoint
 *  API10 Unsafe Consumption         → upstream errors forwarded safely
 */

// ── IN-MEMORY RATE LIMIT STORE ───────────────────────────────────────
// NOTE: Vercel serverless is stateless — resets per cold-start.
// For persistent rate limiting across instances, use Vercel KV or Upstash Redis.
const ipStore  = new Map(); // { ip  → { count, resetAt } }
const keyStore = new Map(); // { keyId → { count, resetAt } }

/**
 * Check and update rate limit for an identifier.
 * Returns { allowed, remaining, resetAt }
 */
function checkRateLimit(store, id, maxReqs, windowMs) {
  const now   = Date.now();
  let   entry = store.get(id);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(id, entry);
  }
  entry.count++;
  return {
    allowed:   entry.count <= maxReqs,
    remaining: Math.max(0, maxReqs - entry.count),
    resetAt:   entry.resetAt,
  };
}

// Prune expired entries every 60s to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipStore)  if (now > v.resetAt) ipStore.delete(k);
  for (const [k, v] of keyStore) if (now > v.resetAt) keyStore.delete(k);
}, 60_000);

// ── RATE LIMIT CONSTANTS ─────────────────────────────────────────────
const IP_LIMIT       = 30;      // requests per IP per window
const IP_WINDOW_MS   = 60_000;  // 1 minute
const KEY_LIMIT      = 100;     // requests per API key per window
const KEY_WINDOW_MS  = 60_000;

// ── REQUEST LIMITS ───────────────────────────────────────────────────
const MAX_BODY_BYTES = 64_000;  // 64 KB max request body
const MAX_MESSAGES   = 40;      // max conversation turns to forward
const MAX_MSG_CHARS  = 8_000;   // max chars per message (truncate, not reject)
const MAX_TOKENS_CAP = 4_096;   // hard ceiling on max_tokens
const MAX_TOKENS_DEF = 1_024;   // default when caller omits max_tokens

// ── MODEL WHITELIST ──────────────────────────────────────────────────
// Prevents callers from requesting expensive/unexpected models
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-6',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

// ── ALLOWED TOP-LEVEL FIELDS ─────────────────────────────────────────
const ALLOWED_FIELDS = new Set(['model','max_tokens','system','messages','temperature']);

// ── SECURITY HEADERS ─────────────────────────────────────────────────
function setSecurityHeaders(res) {
  res.setHeader('X-Frame-Options',            'DENY');
  res.setHeader('X-Content-Type-Options',     'nosniff');
  res.setHeader('Referrer-Policy',            'no-referrer');
  res.setHeader('Content-Security-Policy',    "default-src 'none'");
  res.setHeader('Permissions-Policy',         'camera=(), microphone=(), geolocation=()');
  // CORS: tighten to your domain in production, e.g.:
  //   'https://your-app.vercel.app'
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control',               'no-store, no-cache');
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  setSecurityHeaders(res);

  // Preflight
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Method guard
  if (req.method !== 'POST') {
    return sendError(res, 405, 'method_not_allowed', 'Only POST is accepted.');
  }

  // Body-size guard (Vercel sets content-length before parsing)
  const cl = parseInt(req.headers['content-length'] || '0', 10);
  if (cl > MAX_BODY_BYTES) {
    return sendError(res, 413, 'payload_too_large',
      `Request body must be under ${MAX_BODY_BYTES} bytes.`);
  }

  // IP-based rate limit
  const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = rawIp.split(',')[0].trim();
  const ipCheck  = checkRateLimit(ipStore, clientIp, IP_LIMIT, IP_WINDOW_MS);

  res.setHeader('X-RateLimit-Limit',     IP_LIMIT);
  res.setHeader('X-RateLimit-Remaining', ipCheck.remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(ipCheck.resetAt / 1000));

  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((ipCheck.resetAt - Date.now()) / 1000));
    return sendError(res, 429, 'rate_limit_exceeded',
      'Too many requests. Please wait before trying again.');
  }

  // Body must be a plain object
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendError(res, 400, 'invalid_body', 'Request body must be a JSON object.');
  }

  // Reject unexpected fields (OWASP API3 — mass assignment / over-posting)
  const extra = Object.keys(body).filter(k => !ALLOWED_FIELDS.has(k));
  if (extra.length > 0) {
    return sendError(res, 400, 'unexpected_fields', `Unexpected fields: ${extra.join(', ')}`);
  }

  // Validate model (fall back to safe default — don't error)
  const model = (typeof body.model === 'string' && ALLOWED_MODELS.has(body.model))
    ? body.model : DEFAULT_MODEL;

  // Validate max_tokens
  let maxTokens = parseInt(body.max_tokens, 10);
  if (!Number.isFinite(maxTokens) || maxTokens < 1) maxTokens = MAX_TOKENS_DEF;
  if (maxTokens > MAX_TOKENS_CAP)                    maxTokens = MAX_TOKENS_CAP;

  // Validate system prompt
  let system = '';
  if (body.system !== undefined) {
    if (typeof body.system !== 'string') {
      return sendError(res, 400, 'invalid_system', 'system must be a string.');
    }
    system = body.system.slice(0, 8_000);
  }

  // Validate messages array
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return sendError(res, 400, 'invalid_messages', 'messages must be a non-empty array.');
  }

  const rawMsgs    = body.messages.slice(-MAX_MESSAGES);
  const cleanMsgs  = [];

  for (let i = 0; i < rawMsgs.length; i++) {
    const m = rawMsgs[i];
    if (!m || typeof m !== 'object') {
      return sendError(res, 400, 'invalid_message', `Message[${i}] is not an object.`);
    }
    if (m.role !== 'user' && m.role !== 'assistant') {
      return sendError(res, 400, 'invalid_role',
        `Message[${i}].role must be "user" or "assistant".`);
    }
    if (typeof m.content !== 'string') {
      return sendError(res, 400, 'invalid_content', `Message[${i}].content must be a string.`);
    }
    cleanMsgs.push({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) });
  }

  // Anthropic requires alternating roles, starting with user
  if (cleanMsgs[0].role !== 'user') {
    return sendError(res, 400, 'first_message_user', 'First message must have role "user".');
  }
  for (let i = 1; i < cleanMsgs.length; i++) {
    if (cleanMsgs[i].role === cleanMsgs[i-1].role) {
      return sendError(res, 400, 'alternating_roles',
        'Messages must alternate between "user" and "assistant".');
    }
  }

  // API key from environment ONLY — never from request body / headers
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    console.error('[chat.js] ANTHROPIC_API_KEY missing or malformed');
    return sendError(res, 503, 'service_unavailable',
      'AI service temporarily unavailable.');
  }

  // Key-based secondary rate limit (prevents IP-cycling attacks)
  const keyId    = apiKey.slice(-8); // last 8 chars only — never log full key
  const keyCheck = checkRateLimit(keyStore, keyId, KEY_LIMIT, KEY_WINDOW_MS);
  if (!keyCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((keyCheck.resetAt - Date.now()) / 1000));
    return sendError(res, 429, 'api_quota_exceeded',
      'AI service temporarily rate-limited. Try again in a minute.');
  }

  // Build clean payload — only forward validated fields
  const payload = {
    model,
    max_tokens: maxTokens,
    messages:   cleanMsgs,
    ...(system && { system }),
  };

  // Forward to Anthropic
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,          // server-side only
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      // Sanitize upstream errors — never leak raw Anthropic error structure
      const safeMsg = typeof data?.error?.message === 'string'
        ? data.error.message.slice(0, 300) : 'Upstream error.';
      return res.status(upstream.status).json({ error: { code: 'upstream_error', message: safeMsg } });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[chat.js] upstream fetch error:', err.message);
    return sendError(res, 502, 'bad_gateway', 'Could not reach AI service. Please try again.');
  }
}
