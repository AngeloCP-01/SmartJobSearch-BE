const { parseCorsOrigin } = require('./corsOrigin');

describe('parseCorsOrigin', () => {
  test('unset or blank reflects any origin (local dev)', () => {
    expect(parseCorsOrigin(undefined)).toBe(true);
    expect(parseCorsOrigin('')).toBe(true);
    expect(parseCorsOrigin('  ,  ')).toBe(true);
  });

  test('a single origin stays a plain string', () => {
    expect(parseCorsOrigin('https://applylark.vercel.app')).toBe('https://applylark.vercel.app');
  });

  test('a comma-separated list becomes an array, trimmed, empties dropped', () => {
    expect(parseCorsOrigin(' https://jobtrail-hq.vercel.app , https://applylark.vercel.app,'))
      .toEqual(['https://jobtrail-hq.vercel.app', 'https://applylark.vercel.app']);
  });

  test('a trailing slash is stripped (a browser Origin never has one)', () => {
    expect(parseCorsOrigin('https://applylark.vercel.app/')).toBe('https://applylark.vercel.app');
  });
});
