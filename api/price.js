/**
 * FinAI — Price Proxy (api/price.js)
 * Stocks/ETFs: Yahoo Finance (parallel endpoints) + Stooq (parallel) → first winner
 * Crypto:      CoinGecko + Binance (parallel) → first winner
 * SECURITY: CORS locked, rate limiting, symbol validation, security headers, HSTS
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
  const allowed = [process.env.ALLOWED_ORIGIN || '', 'https://finai-topaz.vercel.app'].filter(Boolean);
  if (!origin) return 'same-origin';
  if (allowed.includes(origin)) return origin;
  if (process.env.NODE_ENV !== 'production') {
    try {
      const h = new URL(origin).hostname;
      if (h === 'localhost' || h === '127.0.0.1') return origin;
    } catch {}
  }
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

// ── CoinGecko crypto fetch ──────────────────────────────────────
const CRYPTO_IDS = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', BNB:'binancecoin', XRP:'ripple',
  ADA:'cardano', AVAX:'avalanche-2', DOT:'polkadot', LINK:'chainlink', UNI:'uniswap',
  LTC:'litecoin', BCH:'bitcoin-cash', TRX:'tron', NEAR:'near', OP:'optimism',
  ARB:'arbitrum', MATIC:'matic-network', ATOM:'cosmos', APT:'aptos', SUI:'sui',
  DOGE:'dogecoin', SHIB:'shiba-inu', PEPE:'pepe', FLOKI:'floki', BONK:'bonk',
  WIF:'dogwifcoin', TON:'the-open-network', POL:'polygon-ecosystem-token',
  FIL:'filecoin', GRT:'the-graph', AAVE:'aave', MKR:'maker', LDO:'lido-dao',
};

async function fetchCoinGecko(sym) {
  const id = CRYPTO_IDS[sym] || sym.toLowerCase();
  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const c = d[id];
    if (!c?.usd) return null;
    const pct  = c.usd_24h_change || 0;
    const prev = c.usd / (1 + pct / 100);
    return { price: c.usd, change: +(c.usd - prev).toFixed(8), changePct: +pct.toFixed(4), prevClose: prev };
  } catch { return null; }
}

// ── Binance crypto fallback ─────────────────────────────────────
const BINANCE_PAIRS = {
  BTC:'BTCUSDT', ETH:'ETHUSDT', SOL:'SOLUSDT', BNB:'BNBUSDT', XRP:'XRPUSDT',
  ADA:'ADAUSDT', AVAX:'AVAXUSDT', DOT:'DOTUSDT', LINK:'LINKUSDT', UNI:'UNIUSDT',
  LTC:'LTCUSDT', TRX:'TRXUSDT', NEAR:'NEARUSDT', OP:'OPUSDT', ARB:'ARBUSDT',
  MATIC:'MATICUSDT', ATOM:'ATOMUSDT', APT:'APTUSDT', SUI:'SUIUSDT',
  DOGE:'DOGEUSDT', SHIB:'SHIBUSDT', PEPE:'PEPEUSDT', FLOKI:'FLOKIUSDT',
  BONK:'BONKUSDT', WIF:'WIFUSDT', TON:'TONUSDT', FIL:'FILUSDT',
  GRT:'GRTUSDT', AAVE:'AAVEUSDT', MKR:'MKRUSDT', LDO:'LDOUSDT',
};

async function fetchBinance(sym) {
  const pair = BINANCE_PAIRS[sym];
  if (!pair) return null;
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const price = parseFloat(d.lastPrice);
    const prev  = parseFloat(d.prevClosePrice);
    if (!price || price <= 0) return null;
    return {
      price,
      change:     +(price - prev).toFixed(8),
      changePct:  +parseFloat(d.priceChangePercent).toFixed(4),
      prevClose:  +prev.toFixed(8),
    };
  } catch { return null; }
}

// ── Yahoo Finance headers + crumb session cache ─────────────────
const YAHOO_HDRS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer':         'https://finance.yahoo.com/',
  'Origin':          'https://finance.yahoo.com',
};

let _yCrumb = null, _yCookies = '', _yAuthExp = 0;

async function refreshYahooCrumb() {
  try {
    const r1 = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': YAHOO_HDRS['User-Agent'], 'Accept': '*/*' },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });
    const rawCookies = r1.headers.get('set-cookie') || '';
    const cookies = rawCookies.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
    const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...YAHOO_HDRS, 'Cookie': cookies },
      signal: AbortSignal.timeout(5000),
    });
    if (!r2.ok) return false;
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length < 2) return false;
    _yCrumb = crumb; _yCookies = cookies; _yAuthExp = Date.now() + 1800000;
    return true;
  } catch { return false; }
}

function parseV8(j) {
  const m = j?.chart?.result?.[0]?.meta;
  if (!m || !(m.regularMarketPrice > 0)) return null;
  const price = m.regularMarketPrice;
  const prev  = m.previousClose || m.chartPreviousClose || price;
  return {
    price,
    change:    +(price - prev).toFixed(4),
    changePct: prev ? +((price - prev) / prev * 100).toFixed(4) : 0,
    prevClose: +prev.toFixed(4),
  };
}

function parseV7(j) {
  const q = j?.quoteResponse?.result?.[0];
  if (!q || !(q.regularMarketPrice > 0)) return null;
  return {
    price:     q.regularMarketPrice,
    change:    +(q.regularMarketChange || 0).toFixed(4),
    changePct: +(q.regularMarketChangePercent || 0).toFixed(4),
    prevClose: +(q.regularMarketPreviousClose || q.regularMarketPrice).toFixed(4),
  };
}

async function fetchYahoo(sym) {
  const enc = encodeURIComponent(sym);
  if (!_yCrumb || Date.now() >= _yAuthExp) await refreshYahooCrumb();
  const crumb = _yCrumb ? `&crumb=${encodeURIComponent(_yCrumb)}` : '';
  const hdrs  = _yCookies ? { ...YAHOO_HDRS, 'Cookie': _yCookies } : YAHOO_HDRS;

  const tryOne = async (url, parse) => {
    try {
      const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      return parse(await r.json());
    } catch { return null; }
  };

  const results = await Promise.allSettled([
    tryOne(`https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=5d${crumb}`, parseV8),
    tryOne(`https://query2.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=5d${crumb}`, parseV8),
    tryOne(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${enc}${crumb}`, parseV7),
    tryOne(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${enc}${crumb}`, parseV7),
  ]);

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return null;
}

// ── CNBC quote service (additional stock fallback) ──────────────
async function fetchCNBC(sym) {
  try {
    const r = await fetch(
      `https://quote.cnbc.com/quote-html-webservice/restservice/cacheRestAPI/getQuotes?symbols=${encodeURIComponent(sym)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`,
      { headers: { 'User-Agent': YAHOO_HDRS['User-Agent'], 'Accept': 'application/json, */*', 'Referer': 'https://www.cnbc.com/' },
        signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const raw = d?.QuickQuoteResult?.QuickQuote;
    if (!raw) return null;
    const q = Array.isArray(raw) ? raw[0] : raw;
    const price = parseFloat(q?.last);
    if (!price || price <= 0) return null;
    const change    = parseFloat(q?.change || 0);
    const changePct = parseFloat(q?.change_pct || 0);
    return { price, change: +change.toFixed(4), changePct: +changePct.toFixed(4), prevClose: +(price - change).toFixed(4) };
  } catch { return null; }
}

// ── Stooq CSV fallback ──────────────────────────────────────────
async function fetchStooq(sym) {
  // Build candidate symbol formats: with .us suffix and without
  const base       = sym.toLowerCase().replace(/=f$/, '').replace(/-usd$/, '');
  const candidates = [`${base}.us`, base];

  for (const s of candidates) {
    try {
      const url = `https://stooq.com/q/l/?s=${s}&f=sd2t2ohlcv&h&e=csv`;
      const r   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const lines = (await r.text()).trim().split('\n');
      if (lines.length < 2) continue;
      const cols  = lines[1].split(',');
      const close = parseFloat(cols[6]);
      const open  = parseFloat(cols[3]);
      // Allow close === open (valid when market closed unchanged)
      if (!close || close <= 0 || isNaN(close)) continue;
      const change    = +(close - open).toFixed(4);
      const changePct = (open && open > 0) ? +((change / open) * 100).toFixed(4) : 0;
      return { price: close, change, changePct, prevClose: open || close };
    } catch { continue; }
  }
  return null;
}

export default async function handler(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed.' });

  setHeaders(res, allowedOrigin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'GET only' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const { allowed, remaining, resetAt } = rateLimit(ip, IP_LIMIT, IP_WIN);
  res.setHeader('X-RateLimit-Limit',     IP_LIMIT);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(resetAt / 1000));
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil((resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const raw  = (req.query.symbol || '').trim().toUpperCase();
  const type = (req.query.type   || '').trim().toLowerCase();
  if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'symbol is required' });
  if (raw.length > 20)                return res.status(400).json({ error: 'Symbol too long' });
  if (!SYM_RE.test(raw))              return res.status(400).json({ error: 'Invalid symbol format' });

  // Crypto: CoinGecko + Binance in parallel, return first winner
  if (type === 'crypto') {
    const [cg, bn] = await Promise.all([fetchCoinGecko(raw), fetchBinance(raw)]);
    if (cg) return ok(res, { ...cg, source: 'CoinGecko' });
    if (bn) return ok(res, { ...bn, source: 'Binance' });
    return err(res, `No crypto price for ${raw}`);
  }

  // Stocks/ETFs/Commodities: Yahoo + CNBC + Stooq in parallel, return first winner
  const [yahoo, cnbc, stooq] = await Promise.all([fetchYahoo(raw), fetchCNBC(raw), fetchStooq(raw)]);
  if (yahoo) return ok(res, { ...yahoo, source: 'Yahoo' });
  if (cnbc)  return ok(res, { ...cnbc,  source: 'CNBC'  });
  if (stooq) return ok(res, { ...stooq, source: 'Stooq' });

  return err(res, `No price data for ${raw}`);
}
