/**
 * StudyBuddy AI — Claude-powered homework completion
 * POST /api/hw-ai
 * Body: { courseId, courseWorkId, title, description, workType, questions, materials }
 * Returns: { type, answers, essayText, confidence }
 */

import { isSession, getFreshAccessToken } from './hw-session.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_BODY = 64 * 1024;

const SYSTEM_PROMPT = `You are an expert academic assistant helping a student complete their homework assignments accurately and thoroughly.

Your job:
1. Read the assignment instructions and any provided materials carefully
2. Complete the assignment fully and correctly
3. For essays/written responses: write in a clear, academic student voice — not overly formal, appropriately detailed
4. For multiple choice: pick the single best answer
5. For math/science: show step-by-step work in your reasoning, then give the final answer
6. For short answer: be concise but complete

Always respond with valid JSON matching the requested format. Do not include anything outside the JSON.`;

function buildPrompt({ title, description, workType, questions }, materialTexts) {
  let prompt = `## Assignment: ${title}\n\n`;
  if (description) prompt += `**Instructions:**\n${description}\n\n`;

  if (materialTexts.length > 0) {
    prompt += `## Course Materials\n\n`;
    for (const m of materialTexts) prompt += `### ${m.title}\n${m.text}\n\n`;
  }

  if (workType === 'MULTIPLE_CHOICE_QUESTION' && questions?.length > 0) {
    prompt += `## Questions\n\nAnswer each multiple-choice question. Return JSON:\n\n`;
    prompt += `{"type":"multipleChoice","answers":[{"questionId":"<id>","answer":"<exact choice text>","reasoning":"<1-2 sentences>"}],"confidence":<0.0-1.0>}\n\n`;
    for (const q of questions) {
      prompt += `**Question ${q.id}:** ${q.title}\n`;
      if (q.choices?.length > 0) for (const c of q.choices) prompt += `  - ${c}\n`;
      prompt += '\n';
    }
  } else if (workType === 'SHORT_ANSWER_QUESTION' && questions?.length > 0) {
    prompt += `## Questions\n\nAnswer each question. Return JSON:\n\n`;
    prompt += `{"type":"shortAnswer","answers":[{"questionId":"<id>","answer":"<your answer>","reasoning":"<brief explanation>"}],"confidence":<0.0-1.0>}\n\n`;
    for (const q of questions) prompt += `**Question ${q.id}:** ${q.title}\n\n`;
  } else {
    prompt += `## Task\n\nComplete this assignment fully. Return JSON:\n\n`;
    prompt += `{"type":"essay","essayText":"<your complete response, use \\n for line breaks>","summary":"<1-2 sentence summary>","confidence":<0.0-1.0>}\n\n`;
    prompt += `Write as a student would — clear, organized, in your own words. Be thorough but not padded.`;
  }
  return prompt;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!isSession(req)) return res.status(401).json({ error: 'Not authenticated' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI not configured' });

  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY) return res.status(413).json({ error: 'Request too large' });

  let body;
  try {
    body = req.body || await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; if (data.length > MAX_BODY) reject(new Error('Too large')); });
      req.on('end', () => resolve(JSON.parse(data)));
      req.on('error', reject);
    });
  } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { title, workType, materials } = body;
  if (!title) return res.status(400).json({ error: 'title required' });

  // Fetch material text from Drive
  const materialTexts = [];
  if (materials?.length > 0) {
    const driveToken = await getFreshAccessToken(req);
    const fetches = materials.filter(m => m.fileId).slice(0, 5).map(async m => {
      try {
        const r = await fetch(
          `https://www.googleapis.com/drive/v3/files/${m.fileId}/export?mimeType=text%2Fplain`,
          { headers: { Authorization: `Bearer ${driveToken}` } }
        );
        if (!r.ok) {
          const r2 = await fetch(
            `https://www.googleapis.com/drive/v3/files/${m.fileId}?alt=media`,
            { headers: { Authorization: `Bearer ${driveToken}` } }
          );
          if (!r2.ok) return null;
          return { title: m.title || 'Attachment', text: (await r2.text()).slice(0, 50_000) };
        }
        return { title: m.title || 'Attachment', text: (await r.text()).slice(0, 50_000) };
      } catch { return null; }
    });
    materialTexts.push(...(await Promise.all(fetches)).filter(Boolean));
  }

  try {
    const anthropicRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildPrompt(body, materialTexts) }],
      }),
    });

    if (!anthropicRes.ok) {
      console.error('[hw-ai] Claude error:', await anthropicRes.text());
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await anthropicRes.json();
    const rawText = data.content?.[0]?.text || '';

    let result;
    try {
      result = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : { type: 'essay', essayText: rawText, confidence: 0.7 };
    }

    result.type = result.type || (workType === 'MULTIPLE_CHOICE_QUESTION' ? 'multipleChoice' : workType === 'SHORT_ANSWER_QUESTION' ? 'shortAnswer' : 'essay');
    result.confidence = typeof result.confidence === 'number' ? result.confidence : 0.8;

    return res.status(200).json(result);
  } catch (err) {
    console.error('[hw-ai]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
