// Aggregation and rendering for an eval run. Pure: takes the per-case results
// the runner produced and returns a summary — no I/O, no model, no clock.

const rate = (hits, total) => (total ? hits / total : null);

// One case can end three ways: scored (the model answered and we checked it),
// error (the model never answered), or skipped. Errors are counted separately
// on purpose — a rate-limited run is not a quality regression, and folding the
// two together is how a provider outage gets misread as the prompt getting worse.
function aggregate(results) {
  const scored = results.filter((r) => r.status === 'scored');
  const errored = results.filter((r) => r.status === 'error');
  const adversarial = scored.filter((r) => r.adversarial);

  const byFeature = {};
  for (const r of scored) {
    const f = (byFeature[r.feature] ||= {
      scored: 0, passed: 0, fabrications: 0, checksRun: 0, checksFailed: 0,
    });
    f.scored += 1;
    if (r.passed) f.passed += 1;
    f.fabrications += r.metrics?.fabrications || 0;
    f.checksRun += r.metrics?.checksRun || 0;
    f.checksFailed += r.metrics?.checksFailed || 0;
  }
  for (const f of Object.values(byFeature)) f.passRate = rate(f.passed, f.scored);

  // Every failed assertion, flattened. A run that says "pass rate fell to 60%"
  // is not actionable; "present-not-fabricated:terraform failed on
  // match-stretch-senior" is.
  const failures = scored.flatMap((r) => (r.checks || [])
    .filter((c) => !c.passed)
    .map((c) => ({
      caseId: r.caseId, feature: r.feature, adversarial: r.adversarial, check: c.name, detail: c.detail,
    })));

  const telemetry = results.map((r) => r.telemetry).filter(Boolean);
  const sum = (key) => telemetry.reduce((acc, t) => acc + (Number.isFinite(t[key]) ? t[key] : 0), 0);
  const latencies = telemetry.map((t) => t.latencyMs).filter(Number.isFinite);

  return {
    totals: {
      cases: results.length,
      scored: scored.length,
      errored: errored.length,
      passed: scored.filter((r) => r.passed).length,
      passRate: rate(scored.filter((r) => r.passed).length, scored.length),
      adversarialCases: adversarial.length,
      adversarialPassRate: rate(adversarial.filter((r) => r.passed).length, adversarial.length),
      // The headline honesty number. Any value above zero is worth a look
      // regardless of what the pass rate says.
      fabrications: scored.reduce((acc, r) => acc + (r.metrics?.fabrications || 0), 0),
      totalTokens: sum('totalTokens'),
      maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
      // How often the chain did not get served by its primary model.
      fellBackCount: telemetry.filter((t) => t.fallbackDepth > 0).length,
    },
    byFeature,
    failures,
    errors: errored.map((r) => ({ caseId: r.caseId, feature: r.feature, error: r.error })),
    results,
  };
}

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);

function formatReport(summary) {
  const t = summary.totals;
  const lines = [];

  lines.push('AI eval run');
  lines.push('='.repeat(60));
  lines.push(`cases        ${t.cases}  (scored ${t.scored}, errored ${t.errored})`);
  lines.push(`pass rate    ${pct(t.passRate)}  (${t.passed}/${t.scored})`);
  lines.push(`adversarial  ${pct(t.adversarialPassRate)}  (${t.adversarialCases} cases)`);
  lines.push(`fabrications ${t.fabrications}`);
  lines.push(`tokens       ${t.totalTokens}   max latency ${t.maxLatencyMs ?? 'n/a'}ms   fell back ${t.fellBackCount}x`);

  lines.push('');
  lines.push('by feature');
  lines.push('-'.repeat(60));
  for (const [feature, f] of Object.entries(summary.byFeature)) {
    lines.push(`  ${feature.padEnd(16)} ${pct(f.passRate).padStart(4)}  ${String(f.passed)}/${f.scored} cases   ${f.checksFailed}/${f.checksRun} checks failed   ${f.fabrications} fabrications`);
  }

  if (summary.failures.length) {
    lines.push('');
    lines.push(`failed checks (${summary.failures.length})`);
    lines.push('-'.repeat(60));
    for (const f of summary.failures) {
      lines.push(`  ${f.adversarial ? '[adv] ' : ''}${f.caseId}`);
      lines.push(`      ${f.check}`);
      if (f.detail) lines.push(`      ${f.detail}`);
    }
  }

  if (summary.errors.length) {
    lines.push('');
    lines.push(`errored cases (${summary.errors.length}) - the model never answered, quality unknown`);
    lines.push('-'.repeat(60));
    for (const e of summary.errors) lines.push(`  ${e.caseId}: ${e.error}`);
  }

  return lines.join('\n');
}

module.exports = { aggregate, formatReport };
