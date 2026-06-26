const { z } = require('zod');

// A pasted job posting (raw text) or a URL to one.
const parsePostingSchema = z.object({
  content: z.string().min(1).max(30000),
});

module.exports = { parsePostingSchema };
