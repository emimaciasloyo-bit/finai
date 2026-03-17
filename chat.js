// FinAI — Serverless Proxy for Anthropic API
// Deployed on Vercel. Keeps your API key server-side.
// All requests from the app go through here → avoids CORS.

export default async function handler(req, res) {
  // Allow requests from any origin (your Netlify/Vercel domain)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({
      error: 'Server misconfigured — ANTHROPIC_API_KEY environment variable not set.'
    });
  }

  try {
    const body = req.body;

    // Validate required fields
    if (!body || !body.messages) {
      return res.status(400).json({ error: 'Missing messages in request body' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 900,
        system: body.system || '',
        messages: body.messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Forward Anthropic's error clearly
      return res.status(response.status).json({
        error: data.error?.message || 'Anthropic API error',
        status: response.status,
        type: data.error?.type || 'unknown',
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({
      error: err.message || 'Internal proxy error',
      type: 'proxy_error',
    });
  }
}
