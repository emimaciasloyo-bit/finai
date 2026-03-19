// FinAI — Real-Time Price Proxy
// Fetches live prices from Yahoo Finance server-side (no CORS, no API key needed)
// Supports: stocks, ETFs, crypto (BTC-USD format), commodities (GC=F format)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Try v8 chart endpoint first
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d&includePrePost=false`;
    const r = await fetch(url, { headers });

    if (r.ok) {
      const json = await r.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice) {
        const price     = meta.regularMarketPrice;
        const prevClose = meta.previousClose || meta.chartPreviousClose || price;
        const change    = +(price - prevClose).toFixed(4);
        const changePct = prevClose ? +((change / prevClose) * 100).toFixed(4) : 0;
        return res.status(200).json({ price, change, changePct, prevClose, source: 'yahoo_v8' });
      }
    }
  } catch(e) {}

  // Try v7 quote endpoint as backup
  try {
    const url2 = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose`;
    const r2 = await fetch(url2, { headers });

    if (r2.ok) {
      const json2 = await r2.json();
      const q = json2?.quoteResponse?.result?.[0];
      if (q?.regularMarketPrice) {
        return res.status(200).json({
          price:     q.regularMarketPrice,
          change:    +(q.regularMarketChange || 0).toFixed(4),
          changePct: +(q.regularMarketChangePercent || 0).toFixed(4),
          prevClose: q.regularMarketPreviousClose || q.regularMarketPrice,
          source:    'yahoo_v7'
        });
      }
    }
  } catch(e) {}

  // Try v10 quoteSummary as final backup
  try {
    const url3 = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price`;
    const r3 = await fetch(url3, { headers });

    if (r3.ok) {
      const json3 = await r3.json();
      const p = json3?.quoteSummary?.result?.[0]?.price;
      if (p?.regularMarketPrice?.raw) {
        const price     = p.regularMarketPrice.raw;
        const prevClose = p.regularMarketPreviousClose?.raw || price;
        return res.status(200).json({
          price,
          change:    +(p.regularMarketChange?.raw || 0).toFixed(4),
          changePct: +(p.regularMarketChangePercent?.raw * 100 || 0).toFixed(4),
          prevClose,
          source: 'yahoo_v10'
        });
      }
    }
  } catch(e) {}

  return res.status(503).json({ error: `Could not fetch price for ${symbol}` });
}
