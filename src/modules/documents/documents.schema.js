const { z } = require('zod');

const TYPES = ['Resume', 'CoverLetter', 'Other'];

const createDocumentSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(TYPES),
  notes: z.string().max(20000).optional(),
});

const updateDocumentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(TYPES).optional(),
  notes: z.string().max(20000).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const linkDocumentSchema = z.object({ documentId: z.string().uuid() });

module.exports = { TYPES, createDocumentSchema, updateDocumentSchema, linkDocumentSchema };
