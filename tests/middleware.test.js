const express = require('express');
const request = require('supertest');
const { z } = require('zod');
const { validate } = require('../src/shared/middleware/validate');
const { errorHandler } = require('../src/shared/middleware/error');
const { NotFoundError } = require('../src/shared/utils/errors');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/echo', validate(z.object({ name: z.string().min(1) })), (req, res) =>
    res.json({ name: req.body.name }));
  app.get('/missing', (req, res, next) => next(new NotFoundError('nope')));
  app.use(errorHandler);
  return app;
}

test('validate rejects invalid body with 400 and details', async () => {
  const res = await request(buildApp()).post('/echo').send({});
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION');
  expect(Array.isArray(res.body.error.details)).toBe(true);
});

test('validate passes valid body through', async () => {
  const res = await request(buildApp()).post('/echo').send({ name: 'Ada' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ name: 'Ada' });
});

test('errorHandler maps AppError to its status + code', async () => {
  const res = await request(buildApp()).get('/missing');
  expect(res.status).toBe(404);
  expect(res.body.error).toMatchObject({ message: 'nope', code: 'NOT_FOUND' });
});
