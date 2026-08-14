const { z } = require('zod');
const {
  PAGE_SIZES, DEFAULT_PAGE_SIZE, offsetShape, cursorShape, sortShape,
  toSkipTake, toOffsetEnvelope, toCursorEnvelope,
} = require('./pagination');

const offsetSchema = z.object(offsetShape);
const cursorSchema = z.object(cursorShape);

test('page sizes are exactly the agreed allowlist', () => {
  expect(PAGE_SIZES).toEqual([10, 25, 50, 100]);
  expect(DEFAULT_PAGE_SIZE).toBe(25);
});

test('offset query defaults to page 1 and the default page size', () => {
  expect(offsetSchema.parse({})).toEqual({ page: 1, pageSize: 25 });
});

test.each(PAGE_SIZES)('offset query accepts allowlisted pageSize %i', (size) => {
  expect(offsetSchema.parse({ pageSize: String(size) }).pageSize).toBe(size);
});

test('offset query REJECTS an out-of-list pageSize rather than clamping', () => {
  const result = offsetSchema.safeParse({ pageSize: '7' });
  expect(result.success).toBe(false);
});

test('offset query rejects page below 1', () => {
  expect(offsetSchema.safeParse({ page: '0' }).success).toBe(false);
});

test('toSkipTake converts a page into skip/take', () => {
  expect(toSkipTake({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
  expect(toSkipTake({ page: 3, pageSize: 10 })).toEqual({ skip: 20, take: 10 });
});

test('toOffsetEnvelope computes totalPages by rounding up', () => {
  expect(toOffsetEnvelope({ items: [], total: 21, page: 1, pageSize: 10 }))
    .toEqual({ items: [], page: 1, pageSize: 10, total: 21, totalPages: 3 });
});

test('toOffsetEnvelope reports 0 totalPages for an empty result, not 1', () => {
  expect(toOffsetEnvelope({ items: [], total: 0, page: 1, pageSize: 25 }).totalPages).toBe(0);
});

test('cursor query defaults pageSize and leaves before undefined', () => {
  expect(cursorSchema.parse({})).toEqual({ pageSize: 25, before: undefined });
});

test('cursor query REJECTS an out-of-list pageSize', () => {
  expect(cursorSchema.safeParse({ pageSize: '7' }).success).toBe(false);
});

test('toCursorEnvelope carries nextCursor and omits total', () => {
  const env = toCursorEnvelope({ items: [{ id: 'a' }], pageSize: 10, nextCursor: 'c1' });
  expect(env).toEqual({ items: [{ id: 'a' }], pageSize: 10, nextCursor: 'c1' });
  expect(env).not.toHaveProperty('total');
});

test('sortShape defaults to the given key and desc, and rejects unknown keys', () => {
  const schema = z.object(sortShape(['createdAt', 'position'], 'createdAt'));
  expect(schema.parse({})).toEqual({ sort: 'createdAt', dir: 'desc' });
  expect(schema.parse({ sort: 'position', dir: 'asc' })).toEqual({ sort: 'position', dir: 'asc' });
  expect(schema.safeParse({ sort: 'dropTable' }).success).toBe(false);
});
