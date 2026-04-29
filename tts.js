/**
 * FinAI — ElevenLabs TTS Proxy (api/tts.js)
 * Keeps ELEVENLABS_API_KEY server-side only.
 * Returns MP3 audio for JARVIS Daniel voice.
 */

const ipStore = new Map();

function checkRateLimit(store, id, maxReqs, windowMs) {
  const now = Date.now();
  let entry = store.get(id);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(id, entry);
  }
  entry.count++;
  return { allowed: entry.count <= maxReqs, resetAt: entry.resetAt };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipStore) if (now > v.resetAt) ipStore.delete(k);
}, 60_000);

function getAllowedOrigin(req) {
  const origin = req.headers['origin'] || '';
  const allowed = [
    process.env.ALLOWED_ORIGIN || '',
    'https://finai-topaz.vercel.app',
  ].filter(Boolean);
  if (!origin) return 'same-origin';
  if (allowed.some(a => origin.startsWith(a))) return origin;
  if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return origin;
  return null;
}

function setHeaders(res, allowedOrigin) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, private');
  if (allowedOrigin && allowedOrigin !== 'same-origin') {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
}

export default async function handler(req, res) {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Forbidden' });

  setHeaders(res, allowedOrigin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Rate limit — 20 TTS calls/min per IP (audio is expensive)
  const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = rawIp.split(',')[0].trim();
  const check = checkRateLimit(ipStore, clientIp, 20, 60_000);
  if (!check.allowed) {
    res.setHeader('Retry-After', Math.ceil((check.resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const body = req.body;
  if (!body || typeof body.text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }

  // Hard cap — ElevenLabs free tier charges per char
  const text = body.text.slice(0, 500).trim();
  if (!text) return res.status(400).json({ error: 'empty text' });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9'; // Daniel fallback ID

  if (!apiKey) {
    console.error('[tts.js] ELEVENLABS_API_KEY missing');
    return res.status(503).json({ error: 'TTS service unavailable' });
  }

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2',
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.82,
            style: 0.25,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!upstream.ok) {
      const err = await upstream.text();
      console.error('[tts.js] ElevenLabs error:', upstream.status, err.slice(0, 200));
      return res.status(upstream.status).json({ error: 'TTS upstream error' });
    }

    const audioBuffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.status(200).send(Buffer.from(audioBuffer));

  } catch (err) {
    console.error('[tts.js] fetch error:', err.message);
    return res.status(502).json({ error: 'TTS gateway error' });
  }
}
