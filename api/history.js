/**
 * FinAI — Price History Proxy (api/history.js)
 * SECURITY v2: CORS locked, rate limiting, symbol validation, HSTS, full security headers
 */

const ipStore = new Map();
function rateLimit(id, max, windowMs) {
  const now = Date.now();
  let e = ipStore.get(id);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; ipStore.set(id, e); }
  e.count++;
  return { allowed: e.count <= max, remaining: Math.max(0, max - e.count), resetAt: e.resetAt };
}
setInterval(() => { const n = Date.now(); for (const [k,v] of ipStore) if (n > v.resetAt) ipStore.delete(k); }, 60000);

const SYM_RE = /^[A-Z0-9\-=\.]{1,20}$/;
const IP_MAX = 120;
const IP_WIN = 60000;

const ALLOWED_RANGES = new Set(['1H','7H','1D','1W','1M','3M','6M','1Y','5Y','ALL']);

const TF_MAP = {
  '1H':  { interval:'2m',   range:'1d'  },
  '7H':  { interval:'5m',   range:'1d'  },
  '1D':  { interval:'30m',  range:'1d'  },
  '1W':  { interval:'1h',   range:'5d'  },
  '1M':  { interval:'1d',   range:'1mo' },
  '3M':  { interval:'1d',   range:'3mo' },
  '6M':  { interval:'1wk',  range:'6mo' },
  '1Y':  { interval:'1wk',  range:'1y'  },
  '5Y':  { interval:'1mo',  range:'5y'  },
  'ALL': { interval:'3mo',  range:'max' },
};

function getAllowedOrigin(req) {
  const origin = req.headers['origin'] || '';
  const allowed = [process.env.ALLOWED_ORIGIN || '', 'https://nodum.vercel.app'].filter(Boolean);
  if (!origin) return 'same-origin';
  if (allowed.some(a => origin.startsWith(a))) return origin;
  if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return origin;
  return null;
}

function setSecurityHeaders(res, allowedOrigin) {
  res.setHeader('X-Content-Type-Options',    'nosniff');
  res.setHeader('X-Frame-Options',           'DENY');
  res.setHeader('Referrer-Policy',           'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Cache-Control',             'public, max-age=60');
  if (allowedOrigin && allowedOrigin !== 'same-origin') {
    res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
}

export default async function handler(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed.' });

  setSecurityHeaders(res, allowedOrigin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'GET only' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const { allowed, remaining, resetAt } = rateLimit(ip, IP_MAX, IP_WIN);
  res.setHeader('X-RateLimit-Limit',     IP_MAX);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(resetAt / 1000));
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil((resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const raw = (req.query.symbol || '').trim().toUpperCase();
  if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'symbol is required' });
  if (!SYM_RE.test(raw)) return res.status(400).json({ error: 'Invalid symbol format' });

  const tf = (req.query.range || '1M').toUpperCase();
  if (!ALLOWED_RANGES.has(tf)) return res.status(400).json({ error: `Invalid range. Allowed: ${[...ALLOWED_RANGES].join(', ')}` });

  const { interval, range } = TF_MAP[tf];
  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
    'Accept':     'application/json',
    'Referer':    'https://finance.yahoo.com',
  };

  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(raw)}?interval=${interval}&range=${range}&includePrePost=false`;
      const r   = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;

      const j      = await r.json();
      const result = j?.chart?.result?.[0];
      if (!result) continue;

      const meta  = result.meta || {};
      const ts    = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};

      const points = ts.map((t, i) => ({
        t: t * 1000,
        c: quote.close?.[i]  ?? null,
        h: quote.high?.[i]   ?? null,
        l: quote.low?.[i]    ?? null,
        v: quote.volume?.[i] ?? null,
      })).filter(p => p.c !== null);

      if (!points.length) continue;

      const closes     = points.map(p => p.c);
      const firstClose = closes[0];
      const lastClose  = closes[closes.length - 1];
      const changeAbs  = lastClose - firstClose;
      const changePct  = firstClose ? (changeAbs / firstClose) * 100 : 0;

      return res.status(200).json({
        symbol:     raw,
        timeframe:  tf,
        currency:   meta.currency || 'USD',
        price:      meta.regularMarketPrice || lastClose,
        change:     +changeAbs.toFixed(4),
        changePct:  +changePct.toFixed(4),
        periodHigh: Math.max(...closes),
        periodLow:  Math.min(...closes),
        points,
      });

    } catch (_) { continue; }
  }

  return res.status(503).json({ error: `No history data available for ${raw}` });
}
