/**
 * StudyBuddy AI — Google Drive file reader
 * GET /api/hw-drive?fileId=X
 * Reads text content from Drive files (Google Docs, PDFs, plain text).
 */

import { isSession, getFreshAccessToken } from './hw-session.js';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const EXPORT_MIME = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!isSession(req)) return res.status(401).json({ error: 'Not authenticated' });

  const { fileId } = req.query || {};
  if (!fileId) return res.status(400).json({ error: 'fileId required' });
  if (!/^[\w\-]{10,200}$/.test(fileId)) return res.status(400).json({ error: 'Invalid fileId' });

  try {
    const token = await getFreshAccessToken(req);

    const metaRes = await fetch(
      `${DRIVE_BASE}/files/${fileId}?fields=id,name,mimeType,size`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!metaRes.ok) throw new Error(`Drive metadata error ${metaRes.status}`);
    const meta = await metaRes.json();

    let text;
    const exportMime = EXPORT_MIME[meta.mimeType];

    if (exportMime) {
      const r = await fetch(
        `${DRIVE_BASE}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) throw new Error(`Drive export error ${r.status}`);
      const buf = await r.arrayBuffer();
      text = Buffer.from(buf).toString('utf-8').slice(0, MAX_TEXT_BYTES);
    } else if (meta.mimeType === 'application/pdf' || meta.mimeType?.startsWith('text/')) {
      const r = await fetch(
        `${DRIVE_BASE}/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) throw new Error(`Drive download error ${r.status}`);
      const buf = await r.arrayBuffer();
      text = Buffer.from(buf).toString('utf-8').slice(0, MAX_TEXT_BYTES);
    } else {
      return res.status(415).json({ error: `Unsupported file type: ${meta.mimeType}` });
    }

    text = text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    return res.status(200).json({ fileId, title: meta.name, mimeType: meta.mimeType, text, truncated: text.length >= MAX_TEXT_BYTES });
  } catch (err) {
    console.error('[hw-drive]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
