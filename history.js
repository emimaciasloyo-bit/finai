/**
 * FinAI — Price History Proxy (api/history.js)
 * Returns OHLC/close data for a symbol + timeframe via Yahoo Finance.
 * No API key needed. Server-side to avoid CORS.
 *
 * Query params:
 *   symbol   — ticker symbol (validated)
 *   range    — 1h, 1d, 7d, 1wk, 1mo, 3mo, 6mo, 1y, 5y, max
 */

const ipStore = new Map();
function rateLimit(id, max, windowMs) {
  const now = Date.now();
  let e = ipStore.get(id);
  if (!e || now > e.resetAt) { e = { count:0, resetAt: now+windowMs }; ipStore.set(id, e); }
  e.count++;
  return { allowed: e.count <= max, resetAt: e.resetAt };
}
setInterval(() => { const n=Date.now(); for(const[k,v]of ipStore)if(n>v.resetAt)ipStore.delete(k); }, 60000);

// Validate symbol — same whitelist as price.js
const SYM_RE = /^[A-Z0-9\-=\.]{1,20}$/;

// Map our timeframe codes to Yahoo Finance interval + range params
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

function setHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=60'); // cache 60s — prices don't need to be instant
}

export default async function handler(req, res) {
  setHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Rate limit
  const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || 'unknown';
  const { allowed } = rateLimit(ip, 120, 60000);
  if (!allowed) return res.status(429).json({ error: 'Rate limit exceeded' });

  // Validate inputs
  const raw = (req.query.symbol||'').trim().toUpperCase();
  const tf  = (req.query.range||'1M').toUpperCase();

  if (!raw || !SYM_RE.test(raw)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  if (!TF_MAP[tf]) {
    return res.status(400).json({ error: 'Invalid range. Use: '+Object.keys(TF_MAP).join(', ') });
  }

  const { interval, range } = TF_MAP[tf];
  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com',
  };

  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(raw)}?interval=${interval}&range=${range}&includePrePost=false`;
      const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const j = await r.json();

      const result = j?.chart?.result?.[0];
      if (!result) continue;

      const meta      = result.meta || {};
      const timestamps= result.timestamp || [];
      const closes    = result.indicators?.quote?.[0]?.close || [];
      const highs     = result.indicators?.quote?.[0]?.high  || [];
      const lows      = result.indicators?.quote?.[0]?.low   || [];
      const opens     = result.indicators?.quote?.[0]?.open  || [];
      const volumes   = result.indicators?.quote?.[0]?.volume|| [];

      if (!closes.length) continue;

      // Build clean data points (filter nulls)
      const points = timestamps.map((ts, i) => ({
        t: ts * 1000,          // ms timestamp
        o: opens[i]   ?? null,
        h: highs[i]   ?? null,
        l: lows[i]    ?? null,
        c: closes[i]  ?? null,
        v: volumes[i] ?? null,
      })).filter(p => p.c !== null);

      if (!points.length) continue;

      const firstClose = points[0].c;
      const lastClose  = points[points.length-1].c;
      const changeAbs  = lastClose - firstClose;
      const changePct  = firstClose ? (changeAbs / firstClose) * 100 : 0;
      const allCloses  = points.map(p => p.c).filter(Boolean);
      const periodHigh = Math.max(...allCloses);
      const periodLow  = Math.min(...allCloses);

      return res.status(200).json({
        symbol:    raw,
        timeframe: tf,
        currency:  meta.currency || 'USD',
        price:     meta.regularMarketPrice || lastClose,
        change:    +changeAbs.toFixed(4),
        changePct: +changePct.toFixed(4),
        periodHigh,
        periodLow,
        points,
      });

    } catch(_) { continue; }
  }

  return res.status(503).json({ error: `No history data for ${raw}` });
}
