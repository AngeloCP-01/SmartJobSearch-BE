const { z } = require('zod');

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

module.exports = {
  runAnalysisSchema, coverLetterSchema, tailorSchema,
  analysisReportSchema, tailoringResultSchema,
};
