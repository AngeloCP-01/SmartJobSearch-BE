// Pure text chunker for RAG indexing: packs paragraphs into ~targetChars chunks
// on natural boundaries, splitting any oversized paragraph on sentence ends, with
// an optional 1-sentence overlap so context isn't lost at a chunk seam. No I/O.
function splitSentences(s) {
  return (s.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);
}

function hardSplit(s, max) {
  const out = [];
  let rest = s.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max; // no space to break on -> hard cut
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
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
      // Hard-split any sentence that exceeds targetChars
      if (sent.length > targetChars) {
        if (buf) units.push(buf);
        for (const piece of hardSplit(sent, targetChars)) units.push(piece);
        buf = '';
      } else if (buf && buf.length + 1 + sent.length > targetChars) {
        units.push(buf);
        buf = sent;
      } else {
        buf = buf ? `${buf} ${sent}` : sent;
      }
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
  // Snapshot chunks before mutating to prevent leaking content from 2+ chunks back
  if (overlapSentences > 0) {
    const original = chunks.slice();
    for (let i = 1; i < chunks.length; i += 1) {
      const tail = splitSentences(original[i - 1]).slice(-overlapSentences).join(' ');
      if (tail) chunks[i] = `${tail} ${chunks[i]}`;
    }
  }
  return chunks;
}

module.exports = { chunkText };
