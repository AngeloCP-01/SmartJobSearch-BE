# OpenRouter free model research — 2026-09-15

## Verified requested model IDs

| Model | Exact OpenRouter ID | Suitability and limitations |
| --- | --- | --- |
| NVIDIA Nemotron 3 Ultra | `nvidia/nemotron-3-ultra-550b-a55b:free` | General reasoning candidate; 1M context. Official page says no `response_format` support. Its free endpoint instructs users not to upload confidential information or personal data and logs sessions for security and product improvement. |
| Poolside Laguna S 2.1 | `poolside/laguna-s-2.1:free` | Coding-focused, 262,144 context. No `response_format` support. Free inputs and outputs may be used for model training. |
| inclusionAI Ling 3.0 Flash Fin | `inclusionai/ling-3.0-flash-fin:free` | Finance-focused, 262,144 context. No `response_format` support. No evidence here establishes better cover-letter or application extraction quality. |

All three official pages list zero input/output token pricing and tool calling. Sources: [Ultra](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free), [Laguna](https://openrouter.ai/poolside/laguna-s-2.1:free), [Ling](https://openrouter.ai/inclusionai/ling-3.0-flash-fin:free).

## Reliability snapshot

At lookup, Ultra's page displayed 28.90-second P50 latency, 5 tokens/second and 75.71% inference availability over three days. Laguna displayed 1.93 seconds, 37 tokens/second and 99.75% availability. These change over time and are not an SLA; the separately reported reachable uptime is not the same as successful inference availability. Ling's retrieved page did not expose comparable metrics. Sources: model pages above.

Inference: Ultra is not a demonstrated reliability upgrade for interactive autofill, despite its size. Laguna's coding specialization and training policy make it an awkward default for personal application content. Evaluate general-purpose alternatives using synthetic or appropriately redacted examples before changing production configuration.

## Free router and limits

`openrouter/free` randomly selects an available free model after filtering for requested features, including structured outputs and tool calling. It does not select a stable, explicitly preferred model. Inference: avoid an unrestricted random router for personal CV content because the selected endpoint's data policy can differ. OpenRouter describes free models as appropriate for experimentation and low-volume use, with different availability from paid models. [Free Models Router documentation](https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground)

The documented free-model limits are 20 requests/minute and 50 requests/day without qualifying credit purchases; purchasing at least $10 in credits raises the daily cap to 1,000, still at 20/minute. The latter is zero token pricing after a paid purchase, not a completely no-spend tier. Daily limits apply across free-model use, so changing the fallback model does not create another daily allowance. [Official FAQ](https://openrouter.ai/docs/faq), [official cost guide](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/)

Provider-side capacity limits can also cause 429 errors. Honor `Retry-After` when provided and use bounded exponential backoff. Free-only fallback chains can improve provider resilience but cannot guarantee successful service. [Limits documentation](https://openrouter.ai/docs/api_reference/limits)

## Live verification and selected configuration

The public [model catalog API](https://openrouter.ai/api/v1/models) was fetched on September 15, 2026. It listed all three requested IDs, but did **not** list `openai/gpt-oss-120b:free` or `qwen/qwen3-next-80b-a3b-instruct:free`, despite model webpages remaining accessible. Prefer the live catalog over an old page when selecting an endpoint.

Selected local configuration, also reflected in `.env.example` and `render.yaml`:

```dotenv
OPENROUTER_MODEL=nex-agi/nex-n2.5-pro:free,nex-agi/nex-n2.5-mini:free,google/gemma-4-31b-it:free
OPENROUTER_REASONING_EFFORT=none
```

The catalog lists zero input/output token pricing and `response_format` support for these models. Nex Pro and Mini explicitly list `none` among supported reasoning efforts. Gemma defaults to thinking disabled and supports configurable reasoning. Sources: [Nex Pro](https://openrouter.ai/nex-agi/nex-n2.5-pro:free), [Nex Mini](https://openrouter.ai/nex-agi/nex-n2.5-mini:free), [Gemma 4 31B](https://openrouter.ai/google/gemma-4-31b-it:free), catalog above.

The existing direct NVIDIA prefix `nvidia:` routes to NVIDIA's API using `NVIDIA_OPENAI_KEY`; it must not be prepended to an OpenRouter model ID. OpenRouter entries use `OPENROUTER_API_KEY`. Embedding configuration is separate and unchanged.

### Reproduced bug and fix

Cover letters previously accepted any nonempty `message.content`, ignored `finish_reason`, and used a 1,200-token output budget. Recognizable planning text could therefore be displayed as a completed letter. Live synthetic Nex probes reproduced `finish_reason=length` with reasoning defaults. Merely excluding reasoning does not stop it consuming the output budget; see [OpenRouter reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

The shared adapter now rejects unfinished responses (including JSON), whitespace/non-string content, and recognizable drafting traces in freeform text. Rejection invokes the existing fallback chain; generated drafting content is not embedded in the new errors. OpenRouter requests exclude reasoning and honor optional `OPENROUTER_REASONING_EFFORT`. Set `none` only for compatible chains; omission retains model defaults. The prompt also explicitly forbids drafting material, signatures/placeholders, and technologies appearing only in the job description.

### Observed checks

- Gemma 4 26B and 31B both returned upstream shared-pool 429 responses on the initial live probes. They are catalog-listed, not demonstrated available in this session.
- Nex Pro with reasoning disabled returned a synthetic letter in about 7.2 seconds and correct auto-fill fields in about 1.6 seconds. Nex Mini also returned final text and correct auto-fill JSON, though its initial letter had a placeholder and an unsupported project timeline inference.
- Initial Nex Pro letter eval: 2/3 passed; the thin-resume case triggered an unsupported-technology keyword check. The runner does not retain raw output, so that initial flag alone does not establish the exact claim made.
- After tightening the prompt: **3/3 cover-letter cases passed**, 20/20 checks, no unsupported-claim flags, maximum latency 12.4 seconds.
- Final local configuration: **4/4 auto-fill cases passed**, 20/20 checks, maximum latency 3.8 seconds. These include missing fields, noisy Taglish text, and non-posting text.

These are small synthetic samples, not proof of sustained uptime or guaranteed factual accuracy. Both Nex fallbacks share a provider; Gemma adds a different provider but was rate-limited during this session. No free chain bypasses platform quotas. Data handling is still subject to the selected provider's terms; fixed IDs do not themselves promise confidential processing.

Reproduce with the backend environment configured:

```sh
LOG_LEVEL=silent npm run eval -- --feature=cover-letter --out=/tmp/jobtrail-cover-letter-eval.json
LOG_LEVEL=silent npm run eval -- --feature=posting-parse --out=/tmp/jobtrail-posting-eval.json
npm test -- --runInBand
```

Only synthetic probe data and existing evaluation fixtures were submitted. No user resume documents were sent. Local code/configuration changed; no production deployment was performed. Update both Render environment values and deploy the backend code together to activate the fix there.

### Backend regression verification

The first full run passed 474 tests with one skipped. After the final reasoning-option test and prompt/config updates, the full run passed 473 tests but failed two auth/activity assertions (401 versus 403, and a missing activity event). A focused rerun of those two suites plus analysis, postings, and the OpenRouter adapter passed **120/120 tests across five suites**. The full-suite result should not be reported as uniformly green. No changes were made to auth/activity to mask those intermittent results.
