const { buildSuggestions } = require('./suggestions');

test('a missing high-weight hard skill yields a high-severity suggestion', () => {
  const s = buildSuggestions({
    subScores: { parseability: 100, sections: 100, contactInfo: 100, formatting: 100, length: 100 },
    sectionFindings: [{ section: 'Skills', present: true }],
    missing: [{ term: 'kubernetes', type: 'hard', jdCount: 3, resumeCount: 0, weight: 7 }],
    meta: { extractionOk: true },
  });
  const k = s.find((x) => x.text.toLowerCase().includes('kubernetes'));
  expect(k).toBeTruthy();
  expect(k.severity).toBe('high');
  expect(k.source).toBe('rule');
});

test('a missing Skills section and missing email produce suggestions', () => {
  const s = buildSuggestions({
    subScores: { parseability: 100, sections: 40, contactInfo: 40, formatting: 100, length: 100 },
    sectionFindings: [{ section: 'Skills', present: false }],
    missing: [],
    meta: { extractionOk: true },
  });
  expect(s.some((x) => /skills.*section/i.test(x.text))).toBe(true);
  expect(s.some((x) => /email/i.test(x.text))).toBe(true);
});

test('an unparseable résumé yields a high-severity parseability warning first', () => {
  const s = buildSuggestions({
    subScores: { parseability: 0, sections: 0, contactInfo: 0, formatting: 0, length: 0 },
    sectionFindings: [],
    missing: [],
    meta: { extractionOk: false },
  });
  expect(s[0].severity).toBe('high');
  expect(/could not|image|parse/i.test(s[0].text)).toBe(true);
});
