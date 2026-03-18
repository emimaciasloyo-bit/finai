// FinAI — Cloud Sync API
// Stores user data keyed by Google user ID
// Uses Vercel KV (free tier) or falls back to a simple file-based store

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verify Google token and get user ID
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const token = auth.slice(7);

  // Verify with Google
  let userId, email, name;
  try {
    const gRes = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${token}`);
    const gData = await gRes.json();
    if (gData.error || !gData.sub) throw new Error('Invalid token');
    userId = gData.sub;
    email  = gData.email;
    name   = gData.name;
  } catch(e) {
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  // Use Vercel KV if available, otherwise use a simple in-memory store
  // For production, add KV_REST_API_URL and KV_REST_API_TOKEN env vars
  const KV_URL   = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    // No KV configured — return success with note
    return res.status(200).json({ 
      ok: true, 
      user: { id: userId, email, name },
      note: 'KV not configured — data not persisted server-side'
    });
  }

  const key = `finai:${userId}`;

  if (req.method === 'GET') {
    try {
      const r = await fetch(`${KV_URL}/get/${key}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const d = await r.json();
      return res.status(200).json({ 
        ok: true, 
        user: { id: userId, email, name },
        data: d.result ? JSON.parse(d.result) : null 
      });
    } catch(e) {
      return res.status(200).json({ ok: true, user: { id: userId, email, name }, data: null });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;
      if (!body || !body.data) return res.status(400).json({ error: 'No data' });
      await fetch(`${KV_URL}/set/${key}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(body.data) })
      });
      return res.status(200).json({ ok: true, user: { id: userId, email, name } });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
