// Pure text chunker for RAG indexing: packs paragraphs into ~targetChars chunks
// on natural boundaries, splitting any oversized paragraph on sentence ends, with
// an optional 1-sentence overlap so context isn't lost at a chunk seam. No I/O.
function splitSentences(s) {
  return (s.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
}

function chunkText(text, { targetChars = 500, overlapSentences = 1 } = {}) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  // Atomic units = paragraphs; an oversized paragraph is broken into sentence packs.
  const units = [];
  for (const para of clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= targetChars) { units.push(para); continue; }
    let buf = '';
    for (const sent of splitSentences(para)) {
      if (buf && buf.length + 1 + sent.length > targetChars) { units.push(buf); buf = sent; }
      else buf = buf ? `${buf} ${sent}` : sent;
    }
    if (buf) units.push(buf);
  }

  // Pack units into chunks up to targetChars.
  const chunks = [];
  let buf = '';
  for (const u of units) {
    if (buf && buf.length + 2 + u.length > targetChars) { chunks.push(buf); buf = u; }
    else buf = buf ? `${buf}\n\n${u}` : u;
  }
  if (buf) chunks.push(buf);

  // Optional overlap: seed each chunk with the previous chunk's final sentence(s).
  if (overlapSentences > 0) {
    for (let i = 1; i < chunks.length; i += 1) {
      const tail = splitSentences(chunks[i - 1]).slice(-overlapSentences).join(' ');
      if (tail) chunks[i] = `${tail} ${chunks[i]}`;
    }
  }
  return chunks;
}

module.exports = { chunkText };
