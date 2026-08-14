const { z } = require('zod');
const { cursorShape } = require('../../shared/pagination');

// Cursor, not offset: activity is an append-only feed. Offset over a feed that
// grows at the top re-serves rows — row 25 becomes row 26 the moment a new
// event lands, so paging to offset 25 returns something already shown.
const listActivityQuerySchema = z.object({
  ...cursorShape,
  applicationId: z.string().uuid().optional(),
});

module.exports = { listActivityQuerySchema };
