// The runner is a script, but its argument parsing and evidence labelling are
// real logic — a silent regression there makes every downstream number wrong
// while the run still looks healthy.
const { parseArgs, sourceNameFor } = require('./run');

describe('parseArgs', () => {
  test('defaults to a live run over every case', () => {
    expect(parseArgs([])).toEqual({ record: false, replay: false, feature: null, case: null, out: null });
  });

  test('reads the filter, mode and output flags', () => {
    const a = parseArgs(['--feature=match', '--case=match-aligned-strong', '--replay', '--record', '--out=/tmp/x.json']);
    expect(a).toEqual({
      record: true, replay: true, feature: 'match', case: 'match-aligned-strong', out: '/tmp/x.json',
    });
  });

  test('ignores unknown flags rather than crashing a long run', () => {
    expect(parseArgs(['--nonsense']).feature).toBeNull();
  });
});

describe('sourceNameFor', () => {
  // The tailor case asserts `groundedInAnyOf: ["node-backend-mid.txt"]`, so the
  // synthesised evidence must carry exactly that label or every add looks
  // ungrounded and the case fails for the wrong reason.
  test('derives the document label from the fixture filename', () => {
    expect(sourceNameFor({ input: { resume: 'fixture:resumes/node-backend-mid.txt' } })).toBe('node-backend-mid.txt');
  });

  test('falls back to a generic label for inline résumé text', () => {
    expect(sourceNameFor({ input: { resume: 'inline text' } })).toBe('this résumé');
  });
});
