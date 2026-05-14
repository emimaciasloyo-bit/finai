/**
 * StudyBuddy AI — Google OAuth 2.0 flow
 * GET /api/hw-oauth?step=start    → redirect to Google consent
 * GET /api/hw-oauth?step=callback → exchange code for tokens, create session, redirect to /study
 */

import { createSession, COOKIE_NAME } from './hw-session.js';

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
  // Default redirect URI targets this same endpoint; override with HW_OAUTH_REDIRECT_URI if needed
  const redirectUri = process.env.HW_OAUTH_REDIRECT_URI ||
    'https://finai-topaz.vercel.app/api/hw-oauth?step=callback';

  if (!clientId || !clientSecret) {
    return res.status(503).json({ error: 'Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).' });
  }

  if (step === 'start') {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
    });
    return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  if (step === 'callback') {
    if (error) return res.redirect(302, `/study?error=${encodeURIComponent(error)}`);
    if (!code) return res.redirect(302, '/study?error=no_code');

    try {
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
        console.error('[hw-oauth] token exchange failed:', await tokenRes.text());
        return res.redirect(302, '/study?error=token_exchange_failed');
      }

      const tokens = await tokenRes.json();
      const { access_token, refresh_token, expires_in } = tokens;

      if (!refresh_token) {
        console.error('[hw-oauth] no refresh_token in response');
        return res.redirect(302, '/study?error=no_refresh_token');
      }

      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const profile = profileRes.ok ? await profileRes.json() : {};

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
      return res.redirect(302, '/study');
    } catch (err) {
      console.error('[hw-oauth] callback error:', err.message);
      return res.redirect(302, '/study?error=server_error');
    }
  }

  return res.status(400).json({ error: 'Use ?step=start or ?step=callback' });
}
