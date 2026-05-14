/**
 * StudyBuddy AI — Submit completed assignment to Google Classroom
 * POST /api/hw-submit
 * Body: { courseId, courseWorkId, submissionId, workType, essayText?, shortAnswer?, multipleChoice?, assignmentTitle? }
 */

import { isSession, getFreshAccessToken } from './hw-session.js';

const CLASS_BASE = 'https://classroom.googleapis.com/v1';
const DOCS_BASE = 'https://docs.googleapis.com/v1/documents';
const MAX_BODY = 512 * 1024;

async function classroomPatch(path, body, token) {
  const res = await fetch(`${CLASS_BASE}${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Classroom PATCH ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function classroomPost(path, body, token) {
  const res = await fetch(`${CLASS_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Classroom POST ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function createGoogleDoc(title, essayText, token) {
  const createRes = await fetch(DOCS_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || 'Assignment Submission' }),
  });
  if (!createRes.ok) throw new Error(`Docs create error ${createRes.status}`);
  const doc = await createRes.json();

  await fetch(`${DOCS_BASE}/${doc.documentId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: essayText } }] }),
  }).catch(err => console.error('[hw-submit] Docs insert warning:', err.message));

  return doc.documentId;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!isSession(req)) return res.status(401).json({ error: 'Not authenticated' });

  let body;
  try {
    body = req.body || await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; if (data.length > MAX_BODY) reject(new Error('Too large')); });
      req.on('end', () => resolve(JSON.parse(data)));
      req.on('error', reject);
    });
  } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { courseId, courseWorkId, submissionId, workType, essayText, shortAnswer, multipleChoice, assignmentTitle } = body;

  if (!courseId || !courseWorkId || !submissionId || !workType) {
    return res.status(400).json({ error: 'courseId, courseWorkId, submissionId, workType required' });
  }

  const subPath = `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}`;

  try {
    const token = await getFreshAccessToken(req);

    if (workType === 'SHORT_ANSWER_QUESTION') {
      if (!shortAnswer) return res.status(400).json({ error: 'shortAnswer required' });
      await classroomPatch(`${subPath}?updateMask=shortAnswerSubmission`, { shortAnswerSubmission: { answer: shortAnswer } }, token);
    } else if (workType === 'MULTIPLE_CHOICE_QUESTION') {
      if (!multipleChoice) return res.status(400).json({ error: 'multipleChoice required' });
      await classroomPatch(`${subPath}?updateMask=multipleChoiceSubmission`, { multipleChoiceSubmission: { answer: multipleChoice } }, token);
    } else {
      if (!essayText) return res.status(400).json({ error: 'essayText required' });
      const docId = await createGoogleDoc(assignmentTitle || 'My Assignment', essayText, token);
      await classroomPatch(
        `${subPath}?updateMask=assignmentSubmission`,
        { assignmentSubmission: { attachments: [{ driveFile: { id: docId } }] } },
        token
      );
    }

    await classroomPost(`${subPath}:turnIn`, {}, token);

    return res.status(200).json({ success: true, submittedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[hw-submit]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
