const { z } = require('zod');

const baseFields = {
  name: z.string().min(1).max(200),
  industry: z.string().max(200).optional(),
  website: z.string().url().max(500).optional(),
  location: z.string().max(200).optional(),
  size: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
};

const createCompanySchema = z.object(baseFields);
const updateCompanySchema = z.object({
  ...baseFields,
  name: baseFields.name.optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

module.exports = { createCompanySchema, updateCompanySchema };
