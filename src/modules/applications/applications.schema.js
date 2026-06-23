const { z } = require('zod');

const STATUSES = [
  'Draft', 'Applied', 'HR_Screening', 'Technical_Interview',
  'Final_Interview', 'Offer', 'Accepted', 'Rejected', 'Withdrawn',
];

const baseFields = {
  position: z.string().min(1).max(200),
  companyId: z.string().uuid().optional(),
  status: z.enum(STATUSES).optional(),
  applicationDate: z.coerce.date().optional(),
  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  source: z.string().max(200).optional(),
  jobDescription: z.string().max(20000).optional(),
  notes: z.string().max(20000).optional(),
};

const salaryOrdered = (d) =>
  d.salaryMin == null || d.salaryMax == null || d.salaryMax >= d.salaryMin;
const salaryMessage = { message: 'salaryMax must be greater than or equal to salaryMin', path: ['salaryMax'] };

const createApplicationSchema = z.object(baseFields).refine(salaryOrdered, salaryMessage);
const updateApplicationSchema = z.object({
  ...baseFields,
  position: baseFields.position.optional(),
})
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' })
  .refine(salaryOrdered, salaryMessage);
const statusSchema = z.object({ status: z.enum(STATUSES) });

module.exports = {
  STATUSES, createApplicationSchema, updateApplicationSchema, statusSchema,
};
