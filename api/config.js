/**
 * FinAI — Public config endpoint
 * Returns non-sensitive environment configuration for the client.
 * Only exposes values that are safe to be public (OAuth client IDs, etc.)
 */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  return res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  });
}
