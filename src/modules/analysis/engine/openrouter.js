const { z } = require('zod');
const { weightOf } = require('./match');

const RESULT_SCHEMA = z.object({
  skills: z.array(z.object({ term: z.string(), type: z.enum(['hard', 'soft']), present: z.boolean() })),
  suggestions: z.array(z.object({ text: z.string(), severity: z.enum(['high', 'medium', 'low']) })),
});

const JSON_SCHEMA = {
  name: 'resume_match',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['skills', 'suggestions'],
    properties: {
      skills: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['term', 'type', 'present'],
        properties: { term: { type: 'string' }, type: { type: 'string', enum: ['hard', 'soft'] }, present: { type: 'boolean' } } } },
      suggestions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'severity'],
        properties: { text: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] } } } },
    },
  },
};

const SYSTEM = 'You extract skills to match a résumé against a job description. Use ONLY skills explicitly stated in the job description. Mark a skill present:true only if it clearly appears in the résumé, otherwise present:false. Never invent skills that are not in the job description. Keep suggestions concrete and honest — do not encourage keyword stuffing. Respond with JSON only.';

// A current free model that honors structured outputs (verified 2026-06).
// Override via OPENROUTER_MODEL. See openrouter.ai/models?supported_parameters=structured_outputs
const DEFAULT_MODEL = 'nvidia/nemotron-nano-9b-v2:free';
const TIMEOUT_MS = 15000;

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
        max_tokens: 800,
        provider: { require_parameters: true },
        response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
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
    const result = RESULT_SCHEMA.parse(JSON.parse(content));
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

module.exports = { complete, aiMatch };
