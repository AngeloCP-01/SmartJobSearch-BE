const { z } = require('zod');

// The agreed page-size allowlist. Out-of-list values are rejected with 400
// rather than clamped: a size the server silently ignores is not a contract,
// because the client cannot tell whether it got what it asked for.
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

const pageSizeField = z.coerce
  .number()
  .int()
  .refine((n) => PAGE_SIZES.includes(n), {
    message: `pageSize must be one of ${PAGE_SIZES.join(', ')}`,
  })
  .default(DEFAULT_PAGE_SIZE);

// Exported as shapes (not schemas) so module query schemas can spread them
// alongside their own filters: z.object({ ...offsetShape, status: ... }).
const offsetShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: pageSizeField,
};

const cursorShape = {
  pageSize: pageSizeField,
  before: z.string().optional(),
};

// Sort keys are an allowlist, never raw input handed to Prisma's orderBy.
function sortShape(allowedKeys, defaultKey = 'createdAt') {
  return {
    sort: z.enum(allowedKeys).default(defaultKey),
    dir: z.enum(['asc', 'desc']).default('desc'),
  };
}

const toSkipTake = ({ page, pageSize }) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

function toOffsetEnvelope({ items, total, page, pageSize }) {
  return {
    items,
    page,
    pageSize,
    total,
    // An empty list has no pages. Reporting "Page 1 of 1" over nothing is a lie
    // the client would render.
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

const toCursorEnvelope = ({ items, pageSize, nextCursor }) => ({ items, pageSize, nextCursor });

module.exports = {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  offsetShape,
  cursorShape,
  sortShape,
  toSkipTake,
  toOffsetEnvelope,
  toCursorEnvelope,
};
