const { z } = require('zod');

const TYPES = ['Resume', 'CoverLetter', 'Note'];

// TipTap/ProseMirror document: an object with a `type` (root is always "doc").
const contentSchema = z.object({ type: z.string() }).passthrough();

const createAuthoredDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(TYPES).optional(),
  applicationId: z.string().uuid().nullable().optional(),
  content: contentSchema.optional(),
});

const updateAuthoredDocumentSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    type: z.enum(TYPES).optional(),
    applicationId: z.string().uuid().nullable().optional(),
    content: contentSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

module.exports = { TYPES, createAuthoredDocumentSchema, updateAuthoredDocumentSchema };
