const { resolveProvider, OpenRouterError } = require('./openrouter');
const { logger } = require('../../../shared/observability/logger');

const DEFAULT_EMBEDDING_MODEL = 'nvidia:nvidia/nv-embedqa-e5-v5';
const EMBED_TIMEOUT_MS = 30000;

function embeddingSpec() { return process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL; }

// True when the configured embedding provider has an API key — used to gate
// index-on-upload so environments without a key (e.g. tests) skip embedding.
// Optional-chained: some test files auto-mock the sibling `./openrouter` module
// wholesale (jest.mock with no factory), which turns `resolveProvider` into a
// jest.fn() returning undefined — this must degrade to "not configured" rather
// than throw, since this is a cross-cutting gate called from unrelated flows
// (e.g. document upload) that have no reason to know about that mock.
function embeddingConfigured() { return Boolean(resolveProvider(embeddingSpec())?.key); }

// Embed an array of texts. `inputType` is required by the asymmetric model:
// 'passage' for indexed content, 'query' for a search string. Returns one vector
// per input, in order. Throws a tagged OpenRouterError on any failure.
async function embed(texts, inputType) {
  if (inputType !== 'passage' && inputType !== 'query') {
    throw new OpenRouterError(`invalid input_type: ${inputType}`, 'config');
  }
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const { provider, model, baseUrl, key } = resolveProvider(embeddingSpec());
  if (!key) throw new OpenRouterError(`API key not configured for the embedding provider (${embeddingSpec()})`, 'config');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    let res;
    try {
      res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts, input_type: inputType }),
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new OpenRouterError('embedding request timed out', 'timeout');
      throw new OpenRouterError(`embedding request failed: ${e.message}`, 'network', { cause: e });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new OpenRouterError(`embedding request failed: ${res.status} ${body.slice(0, 200)}`, 'http', { status: res.status });
    }
    const data = await res.json();
    const vectors = (data && data.data ? data.data : []).map((d) => d.embedding);
    if (vectors.length !== texts.length) throw new OpenRouterError('embedding count mismatch', 'parse');
    // The vectors are the return value, so cost/latency can only surface here.
    // batchSize + inputType separate the two very different callers: bulk
    // 'passage' indexing (rare, large) vs. per-search 'query' (frequent, tiny).
    logger.info({
      model,
      provider,
      inputType,
      batchSize: texts.length,
      latencyMs: Date.now() - startedAt,
      promptTokens: Number.isFinite(data?.usage?.prompt_tokens) ? data.usage.prompt_tokens : null,
      totalTokens: Number.isFinite(data?.usage?.total_tokens) ? data.usage.total_tokens : null,
    }, '[ai] embedding');
    return vectors;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { embed, embeddingConfigured };
