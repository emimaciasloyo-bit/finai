/**
 * Homework AI — Google Classroom proxy
 *
 * GET /api/classroom?resource=courses
 * GET /api/classroom?resource=assignments&courseId=X
 * GET /api/classroom?resource=missing
 * GET /api/classroom?resource=new&since=UNIX_TS_MS
 * GET /api/classroom?resource=submission&courseId=X&courseWorkId=Y
 *
 * All requests require a valid session cookie (set by /api/oauth).
 */

import { isSession, getFreshAccessToken } from './session.js';

const CLASS_BASE = 'https://classroom.googleapis.com/v1';

async function classroomGet(path, token) {
  const res = await fetch(`${CLASS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Classroom API error ${res.status}: ${text}`);
  }
  return res.json();
}

/** Fetch all active courses for the signed-in student. */
async function getCourses(token) {
  const data = await classroomGet('/courses?courseStates=ACTIVE&pageSize=30', token);
  return (data.courses || []).map(c => ({
    id: c.id,
    name: c.name,
    section: c.section || '',
    room: c.room || '',
    courseState: c.courseState,
  }));
}

/** Fetch coursework for one course. */
async function getAssignments(courseId, token) {
  const data = await classroomGet(
    `/courses/${courseId}/courseWork?orderBy=dueDate%20desc&pageSize=50`,
    token
  );
  return (data.courseWork || []).map(normalizeWork);
}

/** Fetch student's own submission for one coursework item. */
async function getSubmission(courseId, courseWorkId, token) {
  const data = await classroomGet(
    `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions?userId=me`,
    token
  );
  const sub = data.studentSubmissions?.[0];
  if (!sub) return null;
  return {
    id: sub.id,
    state: sub.state,
    late: sub.late || false,
    draftGrade: sub.draftGrade,
    assignedGrade: sub.assignedGrade,
    shortAnswerSubmission: sub.shortAnswerSubmission || null,
    multipleChoiceSubmission: sub.multipleChoiceSubmission || null,
    assignmentSubmission: sub.assignmentSubmission || null,
    submissionHistory: (sub.submissionHistory || []).slice(-3),
  };
}

/** Fetch all submissions that are MISSING across all courses. */
async function getMissingAssignments(token) {
  const courses = await getCourses(token);
  const results = [];

  await Promise.all(
    courses.map(async course => {
      try {
        const data = await classroomGet(
          `/courses/${course.id}/studentSubmissions?userId=me&states=MISSING&pageSize=25`,
          token
        );
        for (const sub of data.studentSubmissions || []) {
          // Also fetch the coursework details to get the title
          try {
            const work = await classroomGet(
              `/courses/${course.id}/courseWork/${sub.courseWorkId}`,
              token
            );
            results.push({
              ...normalizeWork(work),
              courseId: course.id,
              courseName: course.name,
              submissionId: sub.id,
              submissionState: sub.state,
              late: sub.late || false,
            });
          } catch {
            // Skip if coursework fetch fails
          }
        }
      } catch {
        // Skip course on error
      }
    })
  );

  // Sort by due date ascending (most overdue first)
  return results.sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return da - db;
  });
}

/** Fetch assignments created after `since` (ms timestamp) across all courses. */
async function getNewAssignments(since, token) {
  const courses = await getCourses(token);
  const results = [];

  await Promise.all(
    courses.map(async course => {
      try {
        const data = await classroomGet(
          `/courses/${course.id}/courseWork?orderBy=updateTime%20desc&pageSize=20`,
          token
        );
        for (const work of data.courseWork || []) {
          const createdMs = work.creationTime ? new Date(work.creationTime).getTime() : 0;
          if (createdMs >= since) {
            results.push({
              ...normalizeWork(work),
              courseId: course.id,
              courseName: course.name,
            });
          }
        }
      } catch {
        // Skip course on error
      }
    })
  );

  return results.sort((a, b) => new Date(b.creationTime || 0) - new Date(a.creationTime || 0));
}

/** Normalize a Classroom courseWork object to a consistent shape. */
function normalizeWork(w) {
  const due = w.dueDate
    ? new Date(
        Date.UTC(w.dueDate.year, w.dueDate.month - 1, w.dueDate.day,
                 w.dueTime?.hours || 23, w.dueTime?.minutes || 59)
      ).toISOString()
    : null;

  const materials = (w.materials || []).map(m => {
    if (m.driveFile) return { type: 'drive', fileId: m.driveFile.driveFile?.id, title: m.driveFile.driveFile?.title, url: m.driveFile.driveFile?.alternateLink };
    if (m.youtubeVideo) return { type: 'youtube', url: m.youtubeVideo.alternateLink, title: m.youtubeVideo.title };
    if (m.link) return { type: 'link', url: m.link.url, title: m.link.title };
    if (m.form) return { type: 'form', url: m.form.formUrl, title: m.form.title };
    return { type: 'unknown' };
  });

  return {
    id: w.id,
    title: w.title || 'Untitled',
    description: w.description || '',
    workType: w.workType || 'ASSIGNMENT',
    dueDate: due,
    creationTime: w.creationTime || null,
    updateTime: w.updateTime || null,
    state: w.state || 'PUBLISHED',
    maxPoints: w.maxPoints || null,
    materials,
    alternateLink: w.alternateLink || null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!isSession(req)) return res.status(401).json({ error: 'Not authenticated' });

  const { resource, courseId, courseWorkId, since } = req.query || {};

  try {
    const token = await getFreshAccessToken(req);

    switch (resource) {
      case 'courses':
        return res.status(200).json({ courses: await getCourses(token) });

      case 'assignments': {
        if (!courseId) return res.status(400).json({ error: 'courseId required' });
        return res.status(200).json({ assignments: await getAssignments(courseId, token) });
      }

      case 'missing':
        return res.status(200).json({ missing: await getMissingAssignments(token) });

      case 'new': {
        const sinceMs = since ? parseInt(since, 10) : Date.now() - 7 * 24 * 60 * 60 * 1000;
        return res.status(200).json({ assignments: await getNewAssignments(sinceMs, token) });
      }

      case 'submission': {
        if (!courseId || !courseWorkId) {
          return res.status(400).json({ error: 'courseId and courseWorkId required' });
        }
        const sub = await getSubmission(courseId, courseWorkId, token);
        return res.status(200).json({ submission: sub });
      }

      default:
        return res.status(400).json({ error: 'Invalid resource. Use: courses, assignments, missing, new, submission' });
    }
  } catch (err) {
    console.error('[classroom]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
