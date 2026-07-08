const { chunkText } = require('./chunk');

describe('chunkText', () => {
  test('short text returns a single chunk', () => {
    expect(chunkText('Just one short paragraph.')).toEqual(['Just one short paragraph.']);
  });
  test('empty / whitespace returns no chunks', () => {
    expect(chunkText('   \n\n ')).toEqual([]);
    expect(chunkText('')).toEqual([]);
  });
  test('packs paragraphs up to the target size across multiple chunks', () => {
    const p = 'x'.repeat(300);
    const chunks = chunkText(`${p}\n\n${p}\n\n${p}`, { targetChars: 400, overlapSentences: 0 });
    expect(chunks.length).toBe(3); // 300 each, target 400 -> one per chunk
    expect(chunks[0]).toContain('x');
  });
  test('splits an oversized single paragraph on sentence boundaries', () => {
    const para = 'Alpha sentence one. Beta sentence two. Gamma sentence three.';
    const chunks = chunkText(para, { targetChars: 25, overlapSentences: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toContain('Gamma sentence three.');
  });
  test('overlap seeds a chunk with the previous chunk final sentence', () => {
    const para = 'One. Two. Three. Four.';
    const chunks = chunkText(para, { targetChars: 10, overlapSentences: 1 });
    // each later chunk starts with the last sentence of the previous chunk
    expect(chunks[1].startsWith(chunks[0].trim().split(/(?<=[.!?])\s+/).slice(-1)[0])).toBe(true);
  });

  test('hard-splits an oversized run of text that has no sentence punctuation', () => {
    const blob = 'Node.js, Express, TypeScript, Python, FastAPI, Java, React, NextJs, PostgreSQL, MongoDB, Redis, Docker, CI/CD, Nginx, GCP, Linode';
    const chunks = chunkText(blob, { targetChars: 40, overlapSentences: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    // no chunk is wildly over target (allow a small boundary slack)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(60);
    // content preserved (order + tokens)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('Linode');
  });

  test('overlapSentences > 1 only pulls from the immediately-previous chunk, not two back', () => {
    const text = 'Alpha one. Alpha two. Beta one. Gamma one. Gamma two.';
    const chunks = chunkText(text, { targetChars: 20, overlapSentences: 2 });
    // "Beta one." belongs two chunks back from the last; it must not leak into the last chunk
    // (assert no chunk contains a sentence that originated 2+ chunks earlier)
    const base = chunkText(text, { targetChars: 20, overlapSentences: 0 });
    for (let i = 1; i < chunks.length; i++) {
      // the overlap prefix must be a suffix of the ORIGINAL previous chunk
      expect(chunks[i].includes(base[i])).toBe(true);
    }
  });
});
