const { z } = require('zod');
const { weightOf } = require('./match');

const RESULT_SCHEMA = z.object({
  skills: z.array(z.object({ term: z.string(), type: z.enum(['hard', 'soft']), present: z.boolean() })),
  suggestions: z.array(z.object({ text: z.string(), severity: z.enum(['high', 'medium', 'low']) })),
});

// Free OpenRouter providers don't reliably honor strict json_schema/constrained
// decoding, so we rely on a forceful prompt + json_object hint + lenient
// extraction + Zod validation instead (works across many more free models).
const SYSTEM = [
  'You are a strict JSON generator for résumé/job-description matching.',
  'Respond with ONLY one minified JSON object — no prose, no explanation, no markdown fences.',
  'Exact shape: {"skills":[{"term":"string","type":"hard","present":true}],"suggestions":[{"text":"string","severity":"high"}]}',
  '"type" is "hard" or "soft". "severity" is "high", "medium", or "low".',
  'Extract skills ONLY from the job description (skip generic filler words).',
  'Set present=true only if the skill clearly appears in the résumé, else false.',
  'Write a few concrete, honest suggestions for the most important missing skills (no keyword stuffing).',
].join(' ');

const DEFAULT_MODEL = 'openai/gpt-oss-120b:free';
const TIMEOUT_MS = 40000;

// Pull the JSON object out of a response that may include prose or ```json fences.
function extractJson(s) {
  const text = String(s);
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  return a >= 0 && b > a ? text.slice(a, b + 1) : text;
}

async function complete(resumeText, jobDescription) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OpenRouter API key not configured');
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://smart-job-search-crm.local',
        'X-Title': 'Smart Job Search CRM',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `JOB DESCRIPTION:\n${jobDescription}\n\nRÉSUMÉ:\n${resumeText}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter request failed: ${res.status}`);
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('OpenRouter returned no content');
    const result = RESULT_SCHEMA.parse(JSON.parse(extractJson(content)));
    return { result, model };
  } finally {
    clearTimeout(timer);
  }
}

async function aiMatch(resumeText, jobDescription) {
  const { result, model } = await complete(resumeText, jobDescription);
  const matched = [];
  const missing = [];
  let total = 0;
  let got = 0;
  for (const s of result.skills) {
    const weight = weightOf({ type: s.type, jdCount: 1 });
    total += weight;
    const entry = { term: s.term, type: s.type, jdCount: 1, resumeCount: s.present ? 1 : 0, weight };
    if (s.present) { matched.push(entry); got += weight; } else { missing.push(entry); }
  }
  const matchScore = total === 0 ? 0 : Math.round((got / total) * 100);
  matched.sort((a, b) => b.weight - a.weight);
  missing.sort((a, b) => b.weight - a.weight);
  const suggestions = result.suggestions.map((x) => ({ text: x.text, severity: x.severity, source: 'ai' }));
  return { matchScore, matched, missing, suggestions, model };
}

module.exports = { complete, aiMatch, extractJson };
