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
});
