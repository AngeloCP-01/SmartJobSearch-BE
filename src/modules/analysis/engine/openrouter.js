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

// An error carrying a `kind` discriminator so callers can log/handle precisely:
//   'config'  — missing/invalid configuration (e.g. no API key)
//   'timeout' — request aborted after TIMEOUT_MS
//   'http'    — non-2xx response from OpenRouter (also carries `.status`)
//   'network' — fetch failed before a response (DNS, connection reset, …)
//   'parse'   — response wasn't valid JSON or didn't match the expected schema
class OpenRouterError extends Error {
  constructor(message, kind, extra = {}) {
    super(message);
    this.name = 'OpenRouterError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

// Pull the JSON object out of a response that may include prose or ```json fences.
function extractJson(s) {
  const text = String(s);
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  return a >= 0 && b > a ? text.slice(a, b + 1) : text;
}

// Read the response body for diagnostics without ever throwing (best-effort).
async function readBody(res) {
  try {
    if (typeof res.text === 'function') return (await res.text()).slice(0, 500);
  } catch { /* ignore — diagnostics only */ }
  return '';
}

// How long the provider asked us to wait, in ms, from the Retry-After header or
// the body's retry_after_seconds. Returns null if unknown/unparseable.
function retryAfterMsFrom(res, body) {
  const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
  if (header != null && header !== '' && Number.isFinite(Number(header))) return Number(header) * 1000;
  try {
    const secs = JSON.parse(body)?.error?.metadata?.retry_after_seconds;
    if (Number.isFinite(secs)) return secs * 1000;
  } catch { /* body wasn't JSON — fine */ }
  return null;
}

// OPENROUTER_MODEL may be a single model or a comma-separated fallback list.
function parseModels() {
  const raw = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [DEFAULT_MODEL];
}

// One model, one attempt: the shared network exchange with OpenRouter. Returns
// the assistant message content (a string); throws a tagged OpenRouterError.
// Reused by both the JSON analysis (`complete`) and freeform text (`generateText`).
async function chat(model, { messages, responseFormat, temperature = 0, maxTokens = 1500 }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterError('OpenRouter API key not configured', 'config');
  const base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // One try around the whole network exchange (request + body read) so a
    // timeout/abort is tagged the same way whether it fires during the request
    // or midway through streaming the response body.
    let data;
    try {
      const body = { model, temperature, max_tokens: maxTokens, messages };
      if (responseFormat) body.response_format = responseFormat;
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://smart-job-search-crm.local',
          'X-Title': 'Smart Job Search CRM',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await readBody(res);
        const extra = { status: res.status, model };
        const retryAfterMs = retryAfterMsFrom(res, errBody);
        if (retryAfterMs != null) extra.retryAfterMs = retryAfterMs;
        throw new OpenRouterError(`OpenRouter request failed: ${res.status}${errBody ? ` — ${errBody}` : ''} (model ${model})`, 'http', extra);
      }
      data = await res.json();
    } catch (e) {
      if (e instanceof OpenRouterError) throw e;
      if (e.name === 'AbortError') throw new OpenRouterError(`OpenRouter request timed out after ${TIMEOUT_MS}ms (model ${model})`, 'timeout', { model });
      throw new OpenRouterError(`OpenRouter request failed: ${e.message} (model ${model})`, 'network', { model, cause: e });
    }

    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new OpenRouterError(`OpenRouter returned no content (model ${model})`, 'parse', { model });
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function complete(resumeText, jobDescription, modelArg) {
  const model = modelArg || parseModels()[0];
  const content = await chat(model, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `JOB DESCRIPTION:\n${jobDescription}\n\nRÉSUMÉ:\n${resumeText}` },
    ],
    responseFormat: { type: 'json_object' },
    temperature: 0,
    maxTokens: 1500,
  });
  try {
    const result = RESULT_SCHEMA.parse(JSON.parse(extractJson(content)));
    return { result, model };
  } catch (e) {
    throw new OpenRouterError(`OpenRouter returned unusable output (model ${model}): ${e.message}`, 'parse', { model, cause: e });
  }
}

// Freeform text generation (e.g. cover letters): raw assistant text, no JSON
// parsing. A little warmth (temperature) since this is prose, not extraction.
async function generateText(messages, modelArg) {
  const model = modelArg || parseModels()[0];
  const content = await chat(model, { messages, temperature: 0.7, maxTokens: 1200 });
  return { text: content.trim(), model };
}

// Worth retrying the SAME model after a short backoff — a transient glitch that
// usually clears in milliseconds. A 429 is deliberately excluded: the provider
// is rate-limited (Retry-After is typically seconds), so trying a DIFFERENT
// model immediately beats waiting. 429 falls through to the next model instead.
const RETRYABLE_HTTP = new Set([500, 502, 503, 504]);
function isRetryableSameModel(err) {
  return err.kind === 'timeout' || err.kind === 'network'
    || (err.kind === 'http' && RETRYABLE_HTTP.has(err.status));
}
// Fatal = pointless to try anything else (same key/config fails for every model).
function isFatal(err) {
  return err.kind === 'config' || (err.kind === 'http' && (err.status === 401 || err.status === 403));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Try each configured model in order; retry transient failures on a model with
// exponential backoff before falling through to the next. Free OpenRouter models
// are frequently rate-limited upstream, so this is the difference between "AI
// unavailable" and a working result. Generic over the per-model attempt so both
// JSON analysis and text generation share one resilience policy.
async function withModelFallback(attempt) {
  const models = parseModels();
  const attempts = Math.max(1, Number(process.env.OPENROUTER_ATTEMPTS || 3));
  const baseMs = Number(process.env.OPENROUTER_RETRY_BASE_MS ?? 400);
  const retryAfterCapMs = Number(process.env.OPENROUTER_RETRY_AFTER_MAX_MS ?? 10000);

  const state = { lastErr: undefined, minRetryAfterMs: Infinity };

  // One pass over every model (with same-model retries for transient glitches).
  // Returns the result, or undefined if the whole chain failed without a fatal.
  async function sweep() {
    for (const model of models) {
      for (let attemptN = 1; attemptN <= attempts; attemptN += 1) {
        try {
          return await attempt(model); // eslint-disable-line no-await-in-loop
        } catch (err) {
          state.lastErr = err;
          if (isFatal(err)) throw err;
          if (err.kind === 'http' && err.status === 429 && Number.isFinite(err.retryAfterMs)) {
            state.minRetryAfterMs = Math.min(state.minRetryAfterMs, err.retryAfterMs);
          }
          if (isRetryableSameModel(err) && attemptN < attempts) {
            await wait(baseMs * 2 ** (attemptN - 1)); // eslint-disable-line no-await-in-loop
            continue;
          }
          break; // rate-limited (429), non-transient (parse), or out of retries → next model
        }
      }
    }
    return undefined;
  }

  const first = await sweep();
  if (first) return first;

  // Whole chain rate-limited at once? These windows are short — wait the time the
  // provider asked for (if reasonable) and re-sweep once before giving up.
  if (Number.isFinite(state.minRetryAfterMs) && state.minRetryAfterMs <= retryAfterCapMs) {
    await wait(state.minRetryAfterMs);
    const second = await sweep();
    if (second) return second;
  }
  throw state.lastErr;
}

function completeWithFallback(resumeText, jobDescription) {
  return withModelFallback((model) => complete(resumeText, jobDescription, model));
}

function generateTextWithFallback(messages) {
  return withModelFallback((model) => generateText(messages, model));
}

async function aiMatch(resumeText, jobDescription) {
  const { result, model } = await completeWithFallback(resumeText, jobDescription);
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

module.exports = {
  complete, completeWithFallback, generateText, generateTextWithFallback, aiMatch, extractJson, OpenRouterError,
};
