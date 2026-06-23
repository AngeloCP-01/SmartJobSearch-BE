const { z } = require('zod');

const TYPES = ['HR', 'Technical', 'Managerial', 'Final'];
const RESULTS = ['Pending', 'Passed', 'Failed'];

const baseFields = {
  applicationId: z.string().uuid(),
  type: z.enum(TYPES),
  scheduledAt: z.coerce.date().optional(),
  interviewer: z.string().max(200).optional(),
  notes: z.string().max(20000).optional(),
  result: z.enum(RESULTS).optional(),
};

const createInterviewSchema = z.object(baseFields);
const updateInterviewSchema = z.object({
  ...baseFields,
  applicationId: baseFields.applicationId.optional(),
  type: baseFields.type.optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

module.exports = { TYPES, RESULTS, createInterviewSchema, updateInterviewSchema };
