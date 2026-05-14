/**
 * FinAI — ElevenLabs TTS Proxy
 * Daniel voice. Key stays server-side only.
 */

const ipStore = new Map();
const TTS_LIMIT = 20;
setInterval(() => { const n = Date.now(); for (const [k,v] of ipStore) if (n > v.resetAt) ipStore.delete(k); }, 60000);

function rateLimit(ip) {
  const now = Date.now();
  let e = ipStore.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60000 }; ipStore.set(ip, e); }
  e.count++;
  return { allowed: e.count <= TTS_LIMIT, remaining: Math.max(0, TTS_LIMIT - e.count), resetAt: e.resetAt };
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const { allowed, remaining, resetAt } = rateLimit(ip);
  res.setHeader('X-RateLimit-Limit', TTS_LIMIT);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil((resetAt - Date.now()) / 1000));
    return res.status(429).json({ error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' } });
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' });

  const clean = text.slice(0, 500).trim();
  if (!clean) return res.status(400).json({ error: 'empty text' });

  const apiKey  = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9';

  if (!apiKey) return res.status(503).json({ error: 'TTS unavailable' });

  try {
    const up = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        text: clean,
        model_id: 'eleven_turbo_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.82, style: 0.25, use_speaker_boost: true }
      })
    });
    if (!up.ok) return res.status(up.status).json({ error: 'ElevenLabs error' });
    const buf = await up.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buf.byteLength);
    return res.status(200).send(Buffer.from(buf));
  } catch (err) {
    console.error('[tts]', err.message);
    return res.status(502).json({ error: 'TTS gateway error' });
  }
}
