const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'as', 'we', 'you', 'our', 'your', 'they', 'their',
  'this', 'that', 'it', 'its', 'will', 'who', 'which', 'have', 'has', 'had', 'need', 'good',
  'experience', 'required', 'skilled', 'years', 'year', 'strong', 'seeking', 'built', 'using',
]);

// keep tech tokens like node.js, ci/cd, c++, c#
const tokenize = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9+#./]*[a-z0-9+#]|[a-z0-9]/g) || []);

const stem = (w) => w.replace(/(ing|ed|es|s)$/i, '');

module.exports = { STOPWORDS, tokenize, stem };
