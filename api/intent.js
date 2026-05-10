/**
 * FinAI — JARVIS Intent Classifier  (api/intent.js)
 * ─────────────────────────────────────────────────────────────────────
 * Uses claude-haiku-4-5 to classify a finance query into one of six
 * intent labels. Fast and cheap — called before every /api/chat request.
 *
 * POST /api/intent
 * Body: { "message": "What is Bitcoin doing right now?" }
 * Returns: { "intent": "price_check" }
 *
 * Intent labels:
 *   price_check        — live quote / current price request
 *   portfolio_analysis — review/analyse user's own holdings
 *   education          — explain a concept, teach a topic
 *   trade_idea         — buy/sell signal, strategy suggestion
 *   news               — recent headlines or events
 *   general            — everything else
 */

// ── RATE LIMIT ───────────────────────────────────────────────────────
const intentIpStore = new Map();

function checkRateLimit(store, id, maxReqs, windowMs) {
  const now   = Date.now();
  let   entry = store.get(id);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(id, entry);
  }
  entry.count++;
  return { allowed: entry.count <= maxReqs, resetAt: entry.resetAt };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of intentIpStore) if (now > v.resetAt) intentIpStore.delete(k);
}, 60_000);

const INTENT_LABELS = ['price_check', 'portfolio_analysis', 'education', 'trade_idea', 'news', 'general'];

// ── ALLOWED ORIGIN ────────────────────────────────────────────────────
function getAllowedOrigin(req) {
  const origin  = req.headers['origin'] || '';
  const allowed = [process.env.ALLOWED_ORIGIN || '', 'https://finai-topaz.vercel.app'].filter(Boolean);
  if (!origin) return 'same-origin';
  if (allowed.some(a => origin.startsWith(a))) return origin;
  if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return origin;
  return null;
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed.' });

  // Security headers
  res.setHeader('X-Frame-Options',         'DENY');
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('Cache-Control',           'no-store, no-cache, private');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  if (allowedOrigin !== 'same-origin') {
    res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Only POST accepted.' });

  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) return res.status(415).json({ error: 'Content-Type must be application/json.' });

  // Rate limit: 60 req/min per IP (generous — haiku is cheap)
  const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = rawIp.split(',')[0].trim();
  const rl       = checkRateLimit(intentIpStore, clientIp, 60, 60_000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', Math.ceil((rl.resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded.' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body.' });

  const message = typeof body.message === 'string' ? body.message.replace(/<[^>]*>/g, '').slice(0, 500).trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return res.status(503).json({ intent: 'general' }); // fail open
  }

  const classifyPrompt = `Classify this finance-related user query into exactly one of these labels:
price_check, portfolio_analysis, education, trade_idea, news, general

Rules:
- price_check: user wants a current price, quote, or how an asset is doing right now
- portfolio_analysis: user asks about their own portfolio, holdings, or P&L
- education: user wants to learn a concept, definition, or how something works
- trade_idea: user wants a buy/sell/hold recommendation or trading strategy
- news: user wants recent news, headlines, or events about an asset or market
- general: anything else financial or off-topic

Return ONLY the label — nothing else, no punctuation, no explanation.

Query: "${message}"`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages:   [{ role: 'user', content: classifyPrompt }],
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!upstream.ok) {
      return res.status(200).json({ intent: 'general' }); // fail open
    }

    const data   = await upstream.json();
    const raw    = (data.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
    const intent = INTENT_LABELS.includes(raw) ? raw : 'general';
    return res.status(200).json({ intent });

  } catch (_) {
    return res.status(200).json({ intent: 'general' }); // always fail open
  }
}
