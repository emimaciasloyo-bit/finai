/**
 * FinAI — Search API Proxy  (api/search.js)
 * SECURITY v2: CORS locked, rate limiting, query sanitization, HSTS, full headers
 */

const ipStore = new Map();

function checkRateLimit(store, id, maxReqs, windowMs) {
  const now   = Date.now();
  let   entry = store.get(id);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(id, entry);
  }
  entry.count++;
  return {
    allowed:   entry.count <= maxReqs,
    remaining: Math.max(0, maxReqs - entry.count),
    resetAt:   entry.resetAt,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipStore) if (now > v.resetAt) ipStore.delete(k);
}, 60_000);

const IP_LIMIT     = 20;
const IP_WINDOW_MS = 60_000;
const MAX_Q_CHARS  = 200;
const MAX_RESULTS  = 5;

const TRUSTED_UPSTREAMS = new Set(['www.googleapis.com', 'api.tavily.com']);

function sanitizeQuery(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .slice(0, MAX_Q_CHARS)
    .replace(/[<>"'`;\\{}[\]|^~]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getAllowedOrigin(req) {
  const origin = req.headers['origin'] || '';
  const allowed = [process.env.ALLOWED_ORIGIN || '', 'https://finai-topaz.vercel.app'].filter(Boolean);
  if (!origin) return 'same-origin';
  if (allowed.some(a => origin.startsWith(a))) return origin;
  if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return origin;
  return null;
}

function setSecurityHeaders(res, allowedOrigin) {
  res.setHeader('X-Frame-Options',           'DENY');
  res.setHeader('X-Content-Type-Options',    'nosniff');
  res.setHeader('Referrer-Policy',           'no-referrer');
  res.setHeader('Content-Security-Policy',   "default-src 'none'");
  res.setHeader('Permissions-Policy',        'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control',             'no-store, no-cache, private');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  if (allowedOrigin && allowedOrigin !== 'same-origin') {
    res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

async function searchYouTube(query, maxResults = MAX_RESULTS) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { source: 'youtube', results: [], error: 'YouTube API key not configured' };

  const upstreamHost = 'www.googleapis.com';
  if (!TRUSTED_UPSTREAMS.has(upstreamHost)) throw new Error('Untrusted upstream');

  const params = new URLSearchParams({
    part: 'snippet', q: query, type: 'video',
    maxResults: String(maxResults), relevanceLanguage: 'en',
    safeSearch: 'moderate', key: apiKey,
  });

  const searchRes = await fetch(
    `https://${upstreamHost}/youtube/v3/search?${params}`,
    { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
  );

  if (!searchRes.ok) {
    const err = await searchRes.json().catch(() => ({}));
    return { source: 'youtube', results: [], error: (err?.error?.message || `YouTube API error ${searchRes.status}`).slice(0, 200) };
  }

  const data  = await searchRes.json();
  const items = data?.items || [];

  let durations = {};
  if (items.length > 0) {
    const ids = items.map(i => i.id?.videoId).filter(Boolean).join(',');
    const detailParams = new URLSearchParams({ part: 'contentDetails', id: ids, key: apiKey });
    const detailRes = await fetch(
      `https://${upstreamHost}/youtube/v3/videos?${detailParams}`,
      { signal: AbortSignal.timeout(5000) }
    ).catch(() => null);
    if (detailRes?.ok) {
      const detail = await detailRes.json();
      for (const v of (detail?.items || [])) {
        const raw = v.contentDetails?.duration || '';
        const m   = raw.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (m) {
          const h = parseInt(m[1] || '0');
          const min = parseInt(m[2] || '0');
          const s   = parseInt(m[3] || '0');
          durations[v.id] = h > 0
            ? `${h}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`
            : `${min}:${String(s).padStart(2,'0')}`;
        }
      }
    }
  }

  const results = items
    .filter(i => i.id?.videoId && i.snippet)
    .map(i => ({
      id:          i.id.videoId,
      title:       (i.snippet.title || '').slice(0, 120),
      channel:     (i.snippet.channelTitle || '').slice(0, 80),
      description: (i.snippet.description || '').slice(0, 300),
      publishedAt: (i.snippet.publishedAt || '').slice(0, 10),
      thumbnail:   i.snippet.thumbnails?.medium?.url || i.snippet.thumbnails?.default?.url || null,
      duration:    durations[i.id.videoId] || null,
      url:         `https://www.youtube.com/watch?v=${i.id.videoId}`,
    }));

  return { source: 'youtube', results };
}

async function searchTavily(query, maxResults = MAX_RESULTS) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { source: 'web', results: [], error: 'Tavily API key not configured' };

  const upstreamHost = 'api.tavily.com';
  if (!TRUSTED_UPSTREAMS.has(upstreamHost)) throw new Error('Untrusted upstream');

  const tavilyRes = await fetch(`https://${upstreamHost}/search`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey, query, search_depth: 'basic',
      max_results: maxResults, include_answer: false,
      include_raw_content: false, include_images: false,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tavilyRes.ok) {
    const err = await tavilyRes.json().catch(() => ({}));
    return { source: 'web', results: [], error: (err?.message || err?.detail || `Tavily error ${tavilyRes.status}`).slice(0, 200) };
  }

  const data    = await tavilyRes.json();
  const results = (data?.results || [])
    .slice(0, maxResults)
    .map(r => ({
      title:   (r.title   || '').slice(0, 120),
      url:     (r.url     || '').slice(0, 300),
      content: (r.content || '').slice(0, 400),
      score:   typeof r.score === 'number' ? Math.round(r.score * 100) / 100 : null,
      domain:  (() => { try { return new URL(r.url).hostname.replace('www.',''); } catch { return ''; } })(),
    }));

  return { source: 'web', results };
}

export default async function handler(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed.' });

  setSecurityHeaders(res, allowedOrigin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Only GET is accepted.');

  const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = rawIp.split(',')[0].trim();
  const ipCheck  = checkRateLimit(ipStore, clientIp, IP_LIMIT, IP_WINDOW_MS);

  res.setHeader('X-RateLimit-Limit',     IP_LIMIT);
  res.setHeader('X-RateLimit-Remaining', ipCheck.remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(ipCheck.resetAt / 1000));

  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((ipCheck.resetAt - Date.now()) / 1000));
    return sendError(res, 429, 'rate_limit_exceeded', 'Too many requests. Please wait.');
  }

  const rawQuery = req.query?.q;
  if (!rawQuery || typeof rawQuery !== 'string') {
    return sendError(res, 400, 'missing_query', 'Query parameter "q" is required.');
  }

  const query = sanitizeQuery(rawQuery);
  if (query.length < 2) {
    return sendError(res, 400, 'query_too_short', 'Query must be at least 2 characters.');
  }

  const rawSource = (req.query?.source || 'all').toLowerCase();
  const source    = ['youtube', 'web', 'all'].includes(rawSource) ? rawSource : 'all';

  const rawMax   = parseInt(req.query?.max || '5', 10);
  const maxCount = Math.min(Math.max(1, isNaN(rawMax) ? 5 : rawMax), MAX_RESULTS);

  try {
    const [ytResult, webResult] = await Promise.all([
      (source === 'youtube' || source === 'all') ? searchYouTube(query, maxCount) : Promise.resolve(null),
      (source === 'web'     || source === 'all') ? searchTavily(query, maxCount)  : Promise.resolve(null),
    ]);

    const response = { query, sources: {} };
    if (ytResult)  response.sources.youtube = ytResult;
    if (webResult) response.sources.web     = webResult;

    return res.status(200).json(response);

  } catch (err) {
    console.error('[search.js] error:', err.message?.slice(0, 200));
    return sendError(res, 502, 'search_failed', 'Search unavailable. Please try again.');
  }
}
