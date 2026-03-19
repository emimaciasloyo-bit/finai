// FinAI — Real-Time Price Proxy
// Server-side Yahoo Finance fetch — no CORS, no API key needed

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const sym = symbol.trim().toUpperCase();
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com',
    'Origin': 'https://finance.yahoo.com',
  };

  // Try v8 chart endpoint
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const json = await r.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice) {
        const price     = meta.regularMarketPrice;
        const prevClose = meta.previousClose || meta.chartPreviousClose || price;
        const change    = price - prevClose;
        const changePct = prevClose ? (change / prevClose) * 100 : 0;
        return res.status(200).json({ price, change, changePct, prevClose });
      }
    }
  } catch(e) {}

  // Try v7 quote endpoint
  try {
    const url2 = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}`;
    const r2 = await fetch(url2, { headers });
    if (r2.ok) {
      const json2 = await r2.json();
      const q = json2?.quoteResponse?.result?.[0];
      if (q?.regularMarketPrice) {
        return res.status(200).json({
          price:     q.regularMarketPrice,
          change:    q.regularMarketChange    || 0,
          changePct: q.regularMarketChangePercent || 0,
          prevClose: q.regularMarketPreviousClose || q.regularMarketPrice,
        });
      }
    }
  } catch(e) {}

  return res.status(503).json({ error: `No price data for ${sym}` });
}
