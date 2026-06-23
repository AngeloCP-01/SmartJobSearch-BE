const { z } = require('zod');

const baseFields = {
  name: z.string().min(1).max(200),
  email: z.string().email().max(320).optional(),
  position: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  linkedinUrl: z.string().url().max(500).optional(),
  notes: z.string().max(20000).optional(),
  companyId: z.string().uuid().nullable().optional(),
  followUpDate: z.coerce.date().nullable().optional(),
};

const createContactSchema = z.object(baseFields);
const updateContactSchema = z.object({
  ...baseFields,
  name: baseFields.name.optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const linkContactSchema = z.object({ contactId: z.string().uuid() });

module.exports = { createContactSchema, updateContactSchema, linkContactSchema };
