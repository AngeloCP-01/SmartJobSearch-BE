const { z } = require('zod');
const { offsetShape, sortShape } = require('../../shared/pagination');

const runAnalysisSchema = z.object({
  applicationId: z.string().uuid(),
  documentId: z.string().uuid(),
  useAi: z.boolean().optional(),
});

const coverLetterSchema = z.object({
  applicationId: z.string().uuid(),
  documentId: z.string().uuid(),
});

const tailorSchema = z.object({
  applicationId: z.string().uuid(),
  documentId: z.string().uuid(),
});

const tailoringSuggestionSchema = z.object({
  kind: z.enum(['add', 'emphasize', 'rephrase', 'remove']),
  text: z.string(),
  why: z.string(),
  groundedIn: z.string(),
  anchor: z.string().nullable().optional().transform((v) => v ?? ''), // verbatim résumé snippet; '' for add
  severity: z.enum(['high', 'medium', 'low']),
});

const tailoringResultSchema = z.object({
  suggestions: z.array(tailoringSuggestionSchema).max(12),
});

const entrySchema = z.object({
  term: z.string(), type: z.enum(['hard', 'soft']),
  jdCount: z.number().int(), resumeCount: z.number().int(), weight: z.number(),
});

const analysisReportSchema = z.object({
  meta: z.object({
    documentName: z.string(), position: z.string().nullable(),
    jdPresent: z.boolean(), extractionOk: z.boolean(), wordCount: z.number().int(),
    aiUsed: z.boolean(), aiModel: z.string().nullable(),
  }),
  atsSubScores: z.object({
    parseability: z.number(), sections: z.number(), contactInfo: z.number(),
    formatting: z.number(), length: z.number(),
  }),
  matched: z.array(entrySchema),
  missing: z.array(entrySchema),
  sectionFindings: z.array(z.object({ section: z.string(), present: z.boolean() })),
  suggestions: z.array(z.object({
    text: z.string(), severity: z.enum(['high', 'medium', 'low']), source: z.enum(['rule', 'ai']),
  })),
});

// documentName/position live in report JSON, not columns — deliberately absent
// from the sort allowlist.
const listAnalysisQuerySchema = z.object({
  ...offsetShape,
  ...sortShape(['createdAt', 'atsScore', 'matchScore'], 'createdAt'),
});

module.exports = {
  listAnalysisQuerySchema,
  runAnalysisSchema, coverLetterSchema, tailorSchema,
  analysisReportSchema, tailoringResultSchema,
};
