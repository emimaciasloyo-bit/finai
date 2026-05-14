/**
 * Homework AI — Claude-powered homework completion
 *
 * POST /api/ai
 * Body: {
 *   courseId, courseWorkId,
 *   title, description,
 *   workType: "ASSIGNMENT" | "SHORT_ANSWER_QUESTION" | "MULTIPLE_CHOICE_QUESTION",
 *   questions: [{ id, title, choices?: string[] }],
 *   materials: [{ fileId, title }]
 * }
 *
 * Returns: { type, answers, essayText, confidence }
 * Streams SSE events for progress during long completions.
 */

import { isSession, getFreshAccessToken } from './session.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_BODY = 64 * 1024; // 64 KB

const SYSTEM_PROMPT = `You are an expert academic assistant helping a student complete their homework assignments accurately and thoroughly.

Your job:
1. Read the assignment instructions and any provided materials carefully
2. Complete the assignment fully and correctly
3. For essays/written responses: write in a clear, academic student voice — not overly formal, appropriately detailed
4. For multiple choice: pick the single best answer
5. For math/science: show step-by-step work in your reasoning, then give the final answer
6. For short answer: be concise but complete

Always respond with valid JSON matching the requested format. Do not include anything outside the JSON.`;

function buildPrompt(body, materialTexts) {
  const { title, description, workType, questions, materials } = body;

  let prompt = `## Assignment: ${title}\n\n`;
  if (description) prompt += `**Instructions:**\n${description}\n\n`;

  if (materialTexts.length > 0) {
    prompt += `## Course Materials\n\n`;
    for (const m of materialTexts) {
      prompt += `### ${m.title}\n${m.text}\n\n`;
    }
  }

  if (workType === 'MULTIPLE_CHOICE_QUESTION' && questions?.length > 0) {
    prompt += `## Questions\n\nAnswer each multiple-choice question. Return your response as JSON:\n\n`;
    prompt += `{"type":"multipleChoice","answers":[{"questionId":"<id>","answer":"<exact choice text>","reasoning":"<1-2 sentences>"}],"confidence":<0.0-1.0>}\n\n`;
    for (const q of questions) {
      prompt += `**Question ${q.id}:** ${q.title}\n`;
      if (q.choices?.length > 0) {
        for (const c of q.choices) prompt += `  - ${c}\n`;
      }
      prompt += '\n';
    }
  } else if (workType === 'SHORT_ANSWER_QUESTION' && questions?.length > 0) {
    prompt += `## Questions\n\nAnswer each question. Return your response as JSON:\n\n`;
    prompt += `{"type":"shortAnswer","answers":[{"questionId":"<id>","answer":"<your answer>","reasoning":"<brief explanation>"}],"confidence":<0.0-1.0>}\n\n`;
    for (const q of questions) {
      prompt += `**Question ${q.id}:** ${q.title}\n\n`;
    }
  } else {
    // ASSIGNMENT type — essay/document
    prompt += `## Task\n\nComplete this assignment fully. Return your response as JSON:\n\n`;
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI not configured' });
  }

  // Read + validate body
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
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { title, description, workType, questions, materials } = body;
  if (!title) return res.status(400).json({ error: 'title required' });

  // Fetch material text from Drive (in parallel)
  const materialTexts = [];
  if (materials?.length > 0) {
    const driveToken = await getFreshAccessToken(req);
    const fetches = materials
      .filter(m => m.fileId)
      .slice(0, 5) // max 5 attachments
      .map(async m => {
        try {
          const r = await fetch(
            `https://www.googleapis.com/drive/v3/files/${m.fileId}/export?mimeType=text%2Fplain`,
            { headers: { Authorization: `Bearer ${driveToken}` } }
          );
          if (!r.ok) {
            // Try direct download as fallback
            const r2 = await fetch(
              `https://www.googleapis.com/drive/v3/files/${m.fileId}?alt=media`,
              { headers: { Authorization: `Bearer ${driveToken}` } }
            );
            if (!r2.ok) return null;
            const text = await r2.text();
            return { title: m.title || 'Attachment', text: text.slice(0, 50_000) };
          }
          const text = await r.text();
          return { title: m.title || 'Attachment', text: text.slice(0, 50_000) };
        } catch {
          return null;
        }
      });
    const results = await Promise.all(fetches);
    materialTexts.push(...results.filter(Boolean));
  }

  const userPrompt = buildPrompt(body, materialTexts);

  // Call Claude
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
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error('[ai] Claude error:', err);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await anthropicRes.json();
    const rawText = data.content?.[0]?.text || '';

    // Extract JSON from the response
    let result;
    try {
      // Try to parse the full text as JSON first
      result = JSON.parse(rawText);
    } catch {
      // Fall back to extracting JSON block from the text
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          result = JSON.parse(match[0]);
        } catch {
          // Last resort: wrap the raw text as an essay
          result = { type: 'essay', essayText: rawText, confidence: 0.7 };
        }
      } else {
        result = { type: 'essay', essayText: rawText, confidence: 0.7 };
      }
    }

    // Ensure required fields
    result.type = result.type || (workType === 'MULTIPLE_CHOICE_QUESTION' ? 'multipleChoice' : workType === 'SHORT_ANSWER_QUESTION' ? 'shortAnswer' : 'essay');
    result.confidence = typeof result.confidence === 'number' ? result.confidence : 0.8;

    return res.status(200).json(result);
  } catch (err) {
    console.error('[ai]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
