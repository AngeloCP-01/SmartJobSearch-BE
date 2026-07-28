const { aggregate, formatReport } = require('./report');

const result = (over = {}) => ({
  caseId: 'c1',
  feature: 'match',
  adversarial: false,
  status: 'scored',
  passed: true,
  checks: [{ name: 'a', passed: true }],
  metrics: { fabrications: 0 },
  telemetry: { model: 'm', fallbackDepth: 0, latencyMs: 100, totalTokens: 1000 },
  ...over,
});

describe('aggregate', () => {
  test('counts pass rate over scored cases', () => {
    const s = aggregate([result(), result({ caseId: 'c2', passed: false })]);
    expect(s.totals.scored).toBe(2);
    expect(s.totals.passed).toBe(1);
    expect(s.totals.passRate).toBeCloseTo(0.5);
  });

  // An errored case is not a failing case — the model never answered, so the
  // quality question is unanswered. Folding errors into the pass rate would
  // make a rate-limited run look like a quality regression.
  test('separates errored cases from failing ones', () => {
    const s = aggregate([result(), result({ caseId: 'c2', status: 'error', passed: false, error: 'AI_UNAVAILABLE' })]);
    expect(s.totals.errored).toBe(1);
    expect(s.totals.scored).toBe(1);
    expect(s.totals.passRate).toBe(1);
  });

  test('sums fabrications across every feature — the headline honesty number', () => {
    const s = aggregate([
      result({ metrics: { fabrications: 2 } }),
      result({ caseId: 'c2', feature: 'tailor', metrics: { fabrications: 1 } }),
    ]);
    expect(s.totals.fabrications).toBe(3);
  });

  test('breaks results down per feature', () => {
    const s = aggregate([
      result({ feature: 'match', passed: true }),
      result({ caseId: 'c2', feature: 'match', passed: false }),
      result({ caseId: 'c3', feature: 'tailor', passed: true }),
    ]);
    expect(s.byFeature.match).toMatchObject({ scored: 2, passed: 1 });
    expect(s.byFeature.tailor).toMatchObject({ scored: 1, passed: 1 });
  });

  // Adversarial cases are where the model actually fails; a run can look
  // healthy overall while every honesty case is red.
  test('reports the adversarial pass rate separately', () => {
    const s = aggregate([
      result({ adversarial: false, passed: true }),
      result({ caseId: 'c2', adversarial: true, passed: false }),
      result({ caseId: 'c3', adversarial: true, passed: true }),
    ]);
    expect(s.totals.adversarialPassRate).toBeCloseTo(0.5);
  });

  test('aggregates cost and latency from telemetry', () => {
    const s = aggregate([
      result({ telemetry: { latencyMs: 100, totalTokens: 1000, fallbackDepth: 0 } }),
      result({ caseId: 'c2', telemetry: { latencyMs: 300, totalTokens: 500, fallbackDepth: 1 } }),
    ]);
    expect(s.totals.totalTokens).toBe(1500);
    expect(s.totals.maxLatencyMs).toBe(300);
    expect(s.totals.fellBackCount).toBe(1);
  });

  test('lists every failed check so a regression names its assertion', () => {
    const s = aggregate([result({
      passed: false,
      checks: [{ name: 'present-not-fabricated:terraform', passed: false, detail: 'claimed' }, { name: 'ok', passed: true }],
    })]);
    expect(s.failures).toEqual([
      expect.objectContaining({ caseId: 'c1', check: 'present-not-fabricated:terraform' }),
    ]);
  });

  test('an empty run does not divide by zero', () => {
    const s = aggregate([]);
    expect(s.totals.passRate).toBeNull();
    expect(s.totals.adversarialPassRate).toBeNull();
  });
});

describe('formatReport', () => {
  test('renders totals, per-feature lines and failures as text', () => {
    const text = formatReport(aggregate([
      result({ feature: 'match', passed: false, checks: [{ name: 'present-not-fabricated:terraform', passed: false, detail: 'claimed present' }] }),
    ]));
    expect(text).toContain('match');
    expect(text).toContain('present-not-fabricated:terraform');
    expect(text).toContain('claimed present');
  });

  test('calls out errored cases explicitly rather than hiding them', () => {
    const text = formatReport(aggregate([result({ status: 'error', error: 'AI_UNAVAILABLE' })]));
    expect(text).toMatch(/error/i);
    expect(text).toContain('AI_UNAVAILABLE');
  });
});
