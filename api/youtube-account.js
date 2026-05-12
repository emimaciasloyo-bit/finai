/**
 * FinAI — YouTube Account Proxy (owner-only)
 * Proxies YouTube Data API v3 calls that require the owner's OAuth token.
 *
 * Endpoints returned via ?resource=:
 *   liked        — owner's liked videos (finance-related)
 *   subscriptions — owner's channel subscriptions
 *   playlists    — owner's playlists
 *
 * Auth: requires valid owner session cookie (set by /api/owner-session).
 * Uses OWNER_YOUTUBE_ACCESS_TOKEN env var (refresh handled automatically).
 */

import { isOwnerSession } from './owner-session.js';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

async function refreshAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: process.env.OWNER_YOUTUBE_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('YouTube token refresh failed');
  const data = await res.json();
  return data.access_token;
}

async function ytFetch(path, accessToken) {
  const res = await fetch(`${YT_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    // Token expired — refresh and retry once
    const newToken = await refreshAccessToken();
    const retry = await fetch(`${YT_BASE}${path}`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    if (!retry.ok) throw new Error(`YouTube API error ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`YouTube API error ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (!isOwnerSession(req)) return res.status(403).json({ error: 'Forbidden' });

  if (!process.env.OWNER_YOUTUBE_REFRESH_TOKEN) {
    return res.status(503).json({ error: 'YouTube account not connected' });
  }

  const resource = req.query?.resource || 'subscriptions';

  try {
    const token = await refreshAccessToken();
    let data;

    if (resource === 'liked') {
      data = await ytFetch(
        '/videos?part=snippet&myRating=liked&maxResults=50&fields=items(id,snippet(title,channelTitle,description))',
        token
      );
    } else if (resource === 'subscriptions') {
      data = await ytFetch(
        '/subscriptions?part=snippet&mine=true&maxResults=50&order=relevance&fields=items(snippet(title,resourceId,description))',
        token
      );
    } else if (resource === 'playlists') {
      data = await ytFetch(
        '/playlists?part=snippet&mine=true&maxResults=50&fields=items(id,snippet(title,description))',
        token
      );
    } else {
      return res.status(400).json({ error: 'Unknown resource. Use: liked | subscriptions | playlists' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[youtube-account]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
