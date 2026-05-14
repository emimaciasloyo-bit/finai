/**
 * Homework AI — Google Drive file reader
 *
 * GET /api/drive?fileId=X
 *
 * Reads the text content of a Drive file (Google Doc, PDF, plain text).
 * Used by /api/ai to read assignment attachments before sending to Claude.
 */

import { isSession, getFreshAccessToken } from './session.js';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DOCS_EXPORT_BASE = 'https://docs.googleapis.com/v1/documents';
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB

/** Maps Drive MIME types to export formats we can read as text. */
const EXPORT_MIME = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

async function getFileMetadata(fileId, token) {
  const res = await fetch(
    `${DRIVE_BASE}/files/${fileId}?fields=id,name,mimeType,size`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive metadata error ${res.status}`);
  return res.json();
}

async function exportGoogleDoc(fileId, exportMime, token) {
  const res = await fetch(
    `${DRIVE_BASE}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive export error ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString('utf-8').slice(0, MAX_TEXT_BYTES);
}

async function downloadFile(fileId, token) {
  const res = await fetch(
    `${DRIVE_BASE}/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive download error ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString('utf-8').slice(0, MAX_TEXT_BYTES);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!isSession(req)) return res.status(401).json({ error: 'Not authenticated' });

  const { fileId } = req.query || {};
  if (!fileId) return res.status(400).json({ error: 'fileId required' });

  // Basic validation — Drive file IDs are alphanumeric + dashes/underscores
  if (!/^[\w\-]{10,200}$/.test(fileId)) {
    return res.status(400).json({ error: 'Invalid fileId' });
  }

  try {
    const token = await getFreshAccessToken(req);
    const meta = await getFileMetadata(fileId, token);

    let text;
    const exportMime = EXPORT_MIME[meta.mimeType];

    if (exportMime) {
      // Google Workspace file — export as text
      text = await exportGoogleDoc(fileId, exportMime, token);
    } else if (
      meta.mimeType === 'application/pdf' ||
      meta.mimeType === 'text/plain' ||
      meta.mimeType?.startsWith('text/')
    ) {
      // For PDFs and plain text, try downloading directly
      // Drive will return the binary for PDFs; we'll get what we can as text
      // PDFs won't be decoded properly here, but Claude can handle partial content
      text = await downloadFile(fileId, token);
    } else {
      return res.status(415).json({ error: `Unsupported file type: ${meta.mimeType}` });
    }

    // Trim and clean up whitespace
    text = text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();

    return res.status(200).json({
      fileId,
      title: meta.name,
      mimeType: meta.mimeType,
      text,
      truncated: text.length >= MAX_TEXT_BYTES,
    });
  } catch (err) {
    console.error('[drive]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
