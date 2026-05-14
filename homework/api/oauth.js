/**
 * Homework AI — Google OAuth 2.0 flow
 *
 * GET /api/oauth?step=start    — redirect user to Google consent page
 * GET /api/oauth?step=callback — exchange authorization code for tokens, create session
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   OAUTH_REDIRECT_URI  (your-app-url/api/oauth?step=callback)
 */

import { createSession, COOKIE_NAME } from './session.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
].join(' ');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { step, code, error } = req.query || {};
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(503).json({ error: 'OAuth not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI.' });
  }

  // ── Step 1: Redirect user to Google consent ──
  if (step === 'start') {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',  // force consent so we always get a refresh_token
    });
    return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  // ── Step 2: Handle callback from Google ──
  if (step === 'callback') {
    if (error) {
      return res.redirect(302, `/?error=${encodeURIComponent(error)}`);
    }
    if (!code) {
      return res.redirect(302, '/?error=no_code');
    }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error('[oauth] token exchange failed:', err);
        return res.redirect(302, '/?error=token_exchange_failed');
      }

      const tokens = await tokenRes.json();
      const { access_token, refresh_token, expires_in } = tokens;

      if (!refresh_token) {
        // Can happen if user already authorized and didn't revoke — prompt=consent should prevent this
        console.error('[oauth] no refresh_token in response');
        return res.redirect(302, '/?error=no_refresh_token');
      }

      // Fetch user profile
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const profile = profileRes.ok ? await profileRes.json() : {};

      // Create server-side session
      const sessionToken = createSession({
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresIn: expires_in,
        email: profile.email || '',
        name: profile.name || '',
        picture: profile.picture || '',
      });

      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
      );
      return res.redirect(302, '/');
    } catch (err) {
      console.error('[oauth] callback error:', err.message);
      return res.redirect(302, '/?error=server_error');
    }
  }

  return res.status(400).json({ error: 'Missing step parameter. Use ?step=start or ?step=callback' });
}
