// FinAI Price Proxy — Yahoo Finance server-side (no CORS)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods','GET'); return res.status(200).end(); }

  const sym = (req.query.symbol || '').trim().toUpperCase();
  if (!sym) return res.status(400).json({ error: 'symbol required' });

  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // v8 chart endpoint
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`, { headers: hdrs });
    if (r.ok) {
      const j = await r.json();
      const m = j?.chart?.result?.[0]?.meta;
      if (m?.regularMarketPrice) {
        const price = m.regularMarketPrice;
        const prev  = m.previousClose || m.chartPreviousClose || price;
        return res.status(200).json({ price, change: price-prev, changePct: prev ? (price-prev)/prev*100 : 0, prevClose: prev });
      }
    }
  } catch(e) {}

  // v7 quote endpoint fallback
  try {
    const r2 = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}`, { headers: hdrs });
    if (r2.ok) {
      const j2 = await r2.json();
      const q   = j2?.quoteResponse?.result?.[0];
      if (q?.regularMarketPrice) {
        return res.status(200).json({
          price:     q.regularMarketPrice,
          change:    q.regularMarketChange || 0,
          changePct: q.regularMarketChangePercent || 0,
          prevClose: q.regularMarketPreviousClose || q.regularMarketPrice,
        });
      }
    }
  } catch(e) {}

  return res.status(503).json({ error: 'No data for ' + sym });
}
