// FinAI Price Proxy — Multi-source real-time prices
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    return res.status(200).end();
  }

  const sym = (req.query.symbol || '').trim().toUpperCase();
  if (!sym) return res.status(400).json({ error: 'symbol required' });

  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://finance.yahoo.com/',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };

  // Try Yahoo v8 chart on both query hosts
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d&includePrePost=false`;
      const r = await fetch(url, { headers: hdrs });
      if (r.ok) {
        const j = await r.json();
        const m = j?.chart?.result?.[0]?.meta;
        if (m?.regularMarketPrice && m.regularMarketPrice > 0) {
          const price = m.regularMarketPrice;
          const prev  = m.previousClose || m.chartPreviousClose || m.regularMarketPreviousClose || price;
          return res.status(200).json({
            price,
            change:    +(price - prev).toFixed(4),
            changePct: prev ? +((price - prev) / prev * 100).toFixed(4) : 0,
            prevClose: prev,
          });
        }
      }
    } catch(e) {}
  }

  // Try Yahoo v7 quote on both hosts
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose`;
      const r = await fetch(url, { headers: hdrs });
      if (r.ok) {
        const j = await r.json();
        const q = j?.quoteResponse?.result?.[0];
        if (q?.regularMarketPrice && q.regularMarketPrice > 0) {
          return res.status(200).json({
            price:     q.regularMarketPrice,
            change:    +(q.regularMarketChange || 0).toFixed(4),
            changePct: +(q.regularMarketChangePercent || 0).toFixed(4),
            prevClose: q.regularMarketPreviousClose || q.regularMarketPrice,
          });
        }
      }
    } catch(e) {}
  }

  // Try Yahoo v10 quoteSummary
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=price`;
    const r = await fetch(url, { headers: hdrs });
    if (r.ok) {
      const j = await r.json();
      const p = j?.quoteSummary?.result?.[0]?.price;
      if (p?.regularMarketPrice?.raw && p.regularMarketPrice.raw > 0) {
        const price = p.regularMarketPrice.raw;
        const prev  = p.regularMarketPreviousClose?.raw || price;
        return res.status(200).json({
          price,
          change:    +(p.regularMarketChange?.raw || 0).toFixed(4),
          changePct: +((p.regularMarketChangePercent?.raw || 0) * 100).toFixed(4),
          prevClose: prev,
        });
      }
    }
  } catch(e) {}

  return res.status(503).json({ error: 'No price data for ' + sym });
}
