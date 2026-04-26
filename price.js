/**
 * FinAI — Price Proxy (api/price.js)
 * Multi-source: Yahoo Finance (with crumb) → Stooq → returns best result
 * SECURITY v2: CORS locked, rate limiting, symbol validation, security headers, HSTS
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

const SYM_RE   = /^[A-Z0-9\-=\.]{1,20}$/;
const IP_LIMIT = 120;
const IP_WIN   = 60000;

function getAllowedOrigin(req) {
  const origin = req.headers['origin'] || '';
  const allowed = [process.env.ALLOWED_ORIGIN || '', 'https://nodum.vercel.app'].filter(Boolean);
  if (!origin) return 'same-origin';
  if (allowed.some(a => origin.startsWith(a))) return origin;
  if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return origin;
  return null;
}

function setHeaders(res, allowedOrigin) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options',        'DENY');
  res.setHeader('Referrer-Policy',        'no-referrer');
  res.setHeader('Cache-Control',          'no-store, private');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  if (allowedOrigin && allowedOrigin !== 'same-origin') {
    res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
}

function ok(res, data)  { return res.status(200).json(data); }
function err(res, msg)  { return res.status(503).json({ error: msg }); }

// ── Yahoo Finance with crumb ──────────────────────────────────────
let yahooSession = null;

async function getYahooCrumb() {
  if (yahooSession && Date.now() < yahooSession.expiresAt) return yahooSession;
  try {
    const consentRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    const setCookie = consentRes.headers.get('set-cookie') || '';
    const cookie    = setCookie.split(';')[0];
    const crumbRes  = await fetch('https://query1.finance.yahoo.com/v1/test/csrfToken', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Cookie': cookie },
    });
    const crumb = (await crumbRes.text()).trim();
    yahooSession = { cookie, crumb, expiresAt: Date.now() + 3600000 };
    return yahooSession;
  } catch(_) { return null; }
}

async function fetchYahoo(sym) {
  const hdrs = {
    'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept':          'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer':         'https://finance.yahoo.com/',
    'Origin':          'https://finance.yahoo.com',
  };
  const session = await getYahooCrumb();
  if (session?.crumb) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d&crumb=${encodeURIComponent(session.crumb)}`;
      const r = await fetch(url, { headers: { ...hdrs, 'Cookie': session.cookie }, signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const j = await r.json();
        const m = j?.chart?.result?.[0]?.meta;
        if (m?.regularMarketPrice > 0) {
          const price = m.regularMarketPrice;
          const prev  = m.previousClose || m.chartPreviousClose || price;
          return { price, change: +(price-prev).toFixed(4), changePct: prev ? +((price-prev)/prev*100).toFixed(4) : 0, prevClose: +prev.toFixed(4) };
        }
      }
    } catch(_) {}
  }
  for (const host of ['query1', 'query2']) {
    for (const [path, parse] of [
      [`/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, j => {
        const m = j?.chart?.result?.[0]?.meta;
        if (m?.regularMarketPrice > 0) {
          const price = m.regularMarketPrice;
          const prev  = m.previousClose || m.chartPreviousClose || price;
          return { price, change: +(price-prev).toFixed(4), changePct: prev ? +((price-prev)/prev*100).toFixed(4) : 0, prevClose: +prev.toFixed(4) };
        }
      }],
      [`/v7/finance/quote?symbols=${encodeURIComponent(sym)}`, j => {
        const q = j?.quoteResponse?.result?.[0];
        if (q?.regularMarketPrice > 0) return { price: q.regularMarketPrice, change: +(q.regularMarketChange||0).toFixed(4), changePct: +(q.regularMarketChangePercent||0).toFixed(4), prevClose: +(q.regularMarketPreviousClose||q.regularMarketPrice).toFixed(4) };
      }],
    ]) {
      try {
        const r = await fetch(`https://${host}.finance.yahoo.com${path}`, { headers: hdrs, signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const result = parse(await r.json());
        if (result) return result;
      } catch(_) {}
    }
  }
  return null;
}

async function fetchStooq(sym) {
  try {
    const stooqSym = sym.toLowerCase().replace('=f','').replace('-usd','') + '.us';
    const url = `https://stooq.com/q/l/?s=${stooqSym}&f=sd2t2ohlcv&h&e=csv`;
    const r   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const lines = (await r.text()).trim().split('\n');
    if (lines.length < 2) return null;
    const cols  = lines[1].split(',');
    const close = parseFloat(cols[6]);
    const open  = parseFloat(cols[3]);
    if (!close || close <= 0 || close === open) return null;
    const change    = +(close - open).toFixed(4);
    const changePct = open ? +((change / open) * 100).toFixed(4) : 0;
    return { price: close, change, changePct, prevClose: open };
  } catch(_) { return null; }
}

export default async function handler(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed.' });

  setHeaders(res, allowedOrigin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const { allowed, remaining, resetAt } = rateLimit(ip, IP_LIMIT, IP_WIN);
  res.setHeader('X-RateLimit-Limit',     IP_LIMIT);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(resetAt / 1000));
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil((resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const raw = (req.query.symbol || '').trim().toUpperCase();
  if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'symbol is required' });
  if (raw.length > 20)                return res.status(400).json({ error: 'Symbol too long' });
  if (!SYM_RE.test(raw))              return res.status(400).json({ error: 'Invalid symbol format' });

  const yahoo = await fetchYahoo(raw);
  if (yahoo) return ok(res, { ...yahoo, source: 'yahoo' });

  const stooq = await fetchStooq(raw);
  if (stooq) return ok(res, { ...stooq, source: 'stooq' });

  return err(res, `No price data for ${raw}`);
}
