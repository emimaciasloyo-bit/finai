/**
 * FinAI — Price Proxy  (api/price.js)
 * ─────────────────────────────────────────────────────────────────────
 * SECURITY:
 *  • Rate limiting (IP-based, 60 req/min)
 *  • Strict symbol validation (regex whitelist — prevents SSRF/injection)
 *  • No user-controlled URL construction after sanitization
 *  • Security headers on every response
 *  • Upstream errors sanitized before forwarding
 */

// ── IN-MEMORY RATE LIMIT ─────────────────────────────────────────────
const ipStore = new Map();

function checkRateLimit(store, id, maxReqs, windowMs) {
  const now = Date.now();
  let e = store.get(id);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; store.set(id, e); }
  e.count++;
  return { allowed: e.count <= maxReqs, remaining: Math.max(0, maxReqs - e.count), resetAt: e.resetAt };
}

setInterval(() => { const now = Date.now(); for (const [k,v] of ipStore) if (now > v.resetAt) ipStore.delete(k); }, 60_000);

const IP_LIMIT    = 60;
const IP_WINDOW   = 60_000;

// Input validation constants
const MAX_SYMBOL_LEN = 20;  // already enforced by SYMBOL_REGEX but explicit
const IP_WINDOW   = 60_000;

// ── SYMBOL VALIDATION ─────────────────────────────────────────────────
// SECURITY: Whitelist regex prevents:
//   - SSRF via crafted symbols containing slashes, protocol schemes, etc.
//   - Injection of query params (no & or ? allowed)
//   - Oversized symbols
// Valid examples: AAPL, BTC-USD, GC=F, MATIC-USD
const SYMBOL_REGEX = /^[A-Z0-9\-=\.]{1,20}$/;

function setSecurityHeaders(res) {
  res.setHeader('X-Frame-Options',          'DENY');
  res.setHeader('X-Content-Type-Options',   'nosniff');
  res.setHeader('Referrer-Policy',          'no-referrer');
  res.setHeader('Content-Security-Policy',  "default-src 'none'");
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control',            'no-store, no-cache');
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

export default async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return sendError(res, 405, 'method_not_allowed', 'Only GET is accepted.');
  }

  // IP rate limit
  const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = rawIp.split(',')[0].trim();
  const ipCheck  = checkRateLimit(ipStore, clientIp, IP_LIMIT, IP_WINDOW);

  res.setHeader('X-RateLimit-Limit',     IP_LIMIT);
  res.setHeader('X-RateLimit-Remaining', ipCheck.remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(ipCheck.resetAt / 1000));

  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((ipCheck.resetAt - Date.now()) / 1000));
    return sendError(res, 429, 'rate_limit_exceeded', 'Too many requests. Please slow down.');
  }

  // Validate symbol — MUST pass before constructing any upstream URL
  const raw = (req.query.symbol || '').trim().toUpperCase();
  if (!raw || typeof raw !== 'string') return sendError(res, 400, 'missing_symbol', 'symbol query parameter is required.');
  if (!SYMBOL_REGEX.test(raw)) {
    return sendError(res, 400, 'invalid_symbol',
      'Symbol must be 1-20 uppercase letters, digits, hyphens, equals signs, or dots.');
  }

  // sym is now safe to interpolate into URLs
  const sym = raw;

  const hdrs = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
    'Accept':          'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer':         'https://finance.yahoo.com',
  };

  // Try Yahoo Finance endpoints in order — both query hosts for redundancy
  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}`,
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(5_000) });
      if (!r.ok) continue;

      const j = await r.json();

      // v8 chart format
      const meta = j?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice > 0) {
        const price = meta.regularMarketPrice;
        const prev  = meta.previousClose || meta.chartPreviousClose || price;
        return res.status(200).json({
          price,
          change:    +(price - prev).toFixed(4),
          changePct: prev ? +((price - prev) / prev * 100).toFixed(4) : 0,
          prevClose: +prev.toFixed(4),
        });
      }

      // v7 quote format
      const q = j?.quoteResponse?.result?.[0];
      if (q?.regularMarketPrice > 0) {
        return res.status(200).json({
          price:     q.regularMarketPrice,
          change:    +(q.regularMarketChange || 0).toFixed(4),
          changePct: +(q.regularMarketChangePercent || 0).toFixed(4),
          prevClose: +(q.regularMarketPreviousClose || q.regularMarketPrice).toFixed(4),
        });
      }

    } catch(_) { /* try next endpoint */ }
  }

  return sendError(res, 503, 'no_price_data', `Could not retrieve price for ${sym}.`);
}
