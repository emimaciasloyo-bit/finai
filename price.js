// FinAI Price Proxy — Yahoo Finance server-side
// Runs on Vercel — no CORS issues, no API key needed
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    return res.status(200).end();
  }

  const raw = (req.query.symbol || '').trim();
  if (!raw) return res.status(400).json({ error: 'symbol required' });

  // URL-encode special chars like = in futures symbols (GC=F, CL=F etc)
  const sym = raw.toUpperCase();

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

  // Try all Yahoo endpoint + host combinations
  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`,
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://finance.yahoo.com',
        },
        // 5 second timeout
        signal: AbortSignal.timeout(5000),
      });

      if (!r.ok) continue;
      const j = await r.json();

      // v8 chart format
      const meta = j?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice > 0) {
        const price = meta.regularMarketPrice;
        const prev  = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPreviousClose || price;
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
    } catch(e) {
      // continue to next endpoint
    }
  }

  return res.status(503).json({ error: 'No price data for ' + sym });
}
