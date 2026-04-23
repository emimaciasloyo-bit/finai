/**
 * FinAI — Price Proxy (api/price.js)
 * Multi-source: Yahoo Finance (with crumb) → Stooq → returns best result
 * Security: rate limiting, symbol validation, security headers
 */

const ipStore = new Map();
function rateLimit(id, max, windowMs) {
  const now = Date.now();
  let e = ipStore.get(id);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; ipStore.set(id, e); }
  e.count++;
  return { allowed: e.count <= max, resetAt: e.resetAt };
}
setInterval(() => { const n = Date.now(); for (const [k,v] of ipStore) if (n > v.resetAt) ipStore.delete(k); }, 60000);

const SYM_RE   = /^[A-Z0-9\-=\.]{1,20}$/;
const IP_LIMIT = 120;
const IP_WIN   = 60000;

function setHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('X-Content-Type-Options',       'nosniff');
  res.setHeader('X-Frame-Options',              'DENY');
  res.setHeader('Cache-Control',                'no-store');
}

function ok(res, data) { return res.status(200).json(data); }
function err(res, msg) { return res.status(503).json({ error: msg }); }

// ── Yahoo Finance with crumb ──────────────────────────────────────
// Yahoo now requires a session cookie + crumb for API calls
// We fetch them server-side — no CORS issue
let yahooSession = null; // { cookie, crumb, expiresAt }

async function getYahooCrumb() {
  if (yahooSession && Date.now() < yahooSession.expiresAt) return yahooSession;
  try {
    // Step 1: get session cookie
    const consentRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    const setCookie  = consentRes.headers.get('set-cookie') || '';
    const cookie     = setCookie.split(';')[0];

    // Step 2: get crumb
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/csrfToken', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': cookie,
      },
    });
    const crumbText = await crumbRes.text();
    const crumb     = crumbText.trim();

    yahooSession = { cookie, crumb, expiresAt: Date.now() + 3600000 }; // 1hr cache
    return yahooSession;
  } catch(_) { return null; }
}

async function fetchYahoo(sym) {
  const hdrs = {
    'User-Agent':       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept':           'application/json',
    'Accept-Language':  'en-US,en;q=0.9',
    'Accept-Encoding':  'gzip, deflate, br',
    'Referer':          'https://finance.yahoo.com/',
    'Origin':           'https://finance.yahoo.com',
  };

  // Try with crumb first (more reliable)
  const session = await getYahooCrumb();
  if (session?.crumb) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d&crumb=${encodeURIComponent(session.crumb)}`;
      const r = await fetch(url, {
        headers: { ...hdrs, 'Cookie': session.cookie },
        signal: AbortSignal.timeout(6000),
      });
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

  // Try without crumb on both hosts
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

// ── Stooq.com (reliable free, no key, no CORS on server) ────────
async function fetchStooq(sym) {
  try {
    // Stooq uses lowercase symbols with .us suffix for US stocks
    const stooqSym = sym.toLowerCase().replace('=f','').replace('-usd','') + '.us';
    const url = `https://stooq.com/q/l/?s=${stooqSym}&f=sd2t2ohlcv&h&e=csv`;
    const r   = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal:  AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const text = await r.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    const cols  = lines[1].split(',');
    // Format: Symbol,Date,Time,Open,High,Low,Close,Volume
    const close = parseFloat(cols[6]);
    const open  = parseFloat(cols[3]);
    if (!close || close <= 0 || close === open) return null; // stooq returns N/D as same values
    const change    = +(close - open).toFixed(4);
    const changePct = open ? +((change / open) * 100).toFixed(4) : 0;
    return { price: close, change, changePct, prevClose: open };
  } catch(_) { return null; }
}

// ── Main handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  setHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const { allowed } = rateLimit(ip, IP_LIMIT, IP_WIN);
  if (!allowed) return res.status(429).json({ error: 'Rate limit exceeded' });

  const raw = (req.query.symbol || '').trim().toUpperCase();
  if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'symbol is required' });
  if (raw.length > 20)                return res.status(400).json({ error: 'Symbol too long (max 20 chars)' });
  if (!SYM_RE.test(raw))              return res.status(400).json({ error: 'Invalid symbol — must be 1-20 uppercase letters/digits/hyphens/dots/equals' });

  // Try Yahoo first, then Stooq
  const yahoo = await fetchYahoo(raw);
  if (yahoo) return ok(res, { ...yahoo, source: 'yahoo' });

  const stooq = await fetchStooq(raw);
  if (stooq) return ok(res, { ...stooq, source: 'stooq' });

  return err(res, `No price data for ${raw}`);
}
