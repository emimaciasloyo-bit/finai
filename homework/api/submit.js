/**
 * Homework AI — Submit completed assignment to Google Classroom
 *
 * POST /api/submit
 * Body: {
 *   courseId, courseWorkId, submissionId,
 *   workType: "ASSIGNMENT" | "SHORT_ANSWER_QUESTION" | "MULTIPLE_CHOICE_QUESTION",
 *   essayText?,        // for ASSIGNMENT type
 *   shortAnswer?,      // for SHORT_ANSWER_QUESTION: string
 *   multipleChoice?,   // for MULTIPLE_CHOICE_QUESTION: string (the answer text)
 *   assignmentTitle?   // used as Google Doc title for essay submissions
 * }
 *
 * Returns: { success: true, submittedAt }
 */

import { isSession, getFreshAccessToken } from './session.js';

const CLASS_BASE = 'https://classroom.googleapis.com/v1';
const DOCS_BASE = 'https://docs.googleapis.com/v1/documents';
const MAX_BODY = 512 * 1024; // 512 KB (essays can be long)

async function classroomPatch(path, body, token) {
  const res = await fetch(`${CLASS_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Classroom PATCH error ${res.status}: ${text}`);
  }
  return res.json();
}

async function classroomPost(path, body, token) {
  const res = await fetch(`${CLASS_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Classroom POST error ${res.status}: ${text}`);
  }
  return res.json();
}

/** Create a Google Doc with the essay text and return its Drive file ID. */
async function createGoogleDoc(title, essayText, token) {
  // Create the document
  const createRes = await fetch(DOCS_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: title || 'Assignment Submission' }),
  });
  if (!createRes.ok) throw new Error(`Docs create error ${createRes.status}`);
  const doc = await createRes.json();
  const docId = doc.documentId;

  // Insert the essay text
  const insertRes = await fetch(`${DOCS_BASE}/${docId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: essayText,
          },
        },
      ],
    }),
  });
  if (!insertRes.ok) {
    const err = await insertRes.text().catch(() => '');
    console.error('[submit] Docs insert error:', err);
    // Non-fatal: doc was created, just missing content
  }

  // The Drive file ID is the same as the doc ID
  return docId;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!isSession(req)) return res.status(401).json({ error: 'Not authenticated' });

  // Read + validate body
  let body;
  try {
    body = req.body || await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; if (data.length > MAX_BODY) reject(new Error('Too large')); });
      req.on('end', () => resolve(JSON.parse(data)));
      req.on('error', reject);
    });
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { courseId, courseWorkId, submissionId, workType, essayText, shortAnswer, multipleChoice, assignmentTitle } = body;

  if (!courseId || !courseWorkId || !submissionId) {
    return res.status(400).json({ error: 'courseId, courseWorkId, submissionId required' });
  }
  if (!workType) {
    return res.status(400).json({ error: 'workType required' });
  }

  const subPath = `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}`;

  try {
    const token = await getFreshAccessToken(req);

    if (workType === 'SHORT_ANSWER_QUESTION') {
      if (!shortAnswer) return res.status(400).json({ error: 'shortAnswer required' });

      // Patch the submission with the short answer
      await classroomPatch(
        `${subPath}?updateMask=shortAnswerSubmission`,
        { shortAnswerSubmission: { answer: shortAnswer } },
        token
      );
    } else if (workType === 'MULTIPLE_CHOICE_QUESTION') {
      if (!multipleChoice) return res.status(400).json({ error: 'multipleChoice required' });

      await classroomPatch(
        `${subPath}?updateMask=multipleChoiceSubmission`,
        { multipleChoiceSubmission: { answer: multipleChoice } },
        token
      );
    } else {
      // ASSIGNMENT type — create a Google Doc and attach it
      if (!essayText) return res.status(400).json({ error: 'essayText required' });

      const docId = await createGoogleDoc(assignmentTitle || 'My Assignment', essayText, token);

      // Attach the Google Doc to the submission
      await classroomPatch(
        `${subPath}?updateMask=assignmentSubmission`,
        {
          assignmentSubmission: {
            attachments: [
              {
                driveFile: {
                  id: docId,
                },
              },
            ],
          },
        },
        token
      );
    }

    // Turn it in
    await classroomPost(`${subPath}:turnIn`, {}, token);

    const submittedAt = new Date().toISOString();
    return res.status(200).json({ success: true, submittedAt });
  } catch (err) {
    console.error('[submit]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
