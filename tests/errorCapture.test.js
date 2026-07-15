const express = require('express');
const request = require('supertest');

const mockCapture = jest.fn();
jest.mock('../src/shared/observability/sentry', () => ({
  captureError: mockCapture,
  initSentry: jest.fn(),
}));

const { errorHandler } = require('../src/shared/middleware/error');
const { logger } = require('../src/shared/observability/logger');
const { AppError, NotFoundError } = require('../src/shared/utils/errors');

function buildApp() {
  const app = express();
  app.get('/throw-plain', (req, res, next) => next(new Error('kaboom')));
  app.get('/throw-404', (req, res, next) => next(new NotFoundError('nope')));
  app.get('/throw-500-apperror', (req, res, next) => next(new AppError('down', 503, 'STORAGE_UNAVAILABLE')));
  app.use(errorHandler);
  return app;
}

beforeEach(() => mockCapture.mockReset());

test('captures unexpected (non-AppError) errors', async () => {
  const res = await request(buildApp()).get('/throw-plain');
  expect(res.status).toBe(500);
  expect(mockCapture).toHaveBeenCalledTimes(1);
});

test('logs server-side (5xx) errors at error level with the message', async () => {
  const errSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  try {
    await request(buildApp()).get('/throw-500-apperror');
    expect(errSpy).toHaveBeenCalled();
    const [ctx, msg] = errSpy.mock.calls[0];
    expect(ctx.err.code).toBe('STORAGE_UNAVAILABLE');
    expect(msg).toBe('down');
  } finally {
    errSpy.mockRestore();
  }
});

test('does NOT log 4xx client errors at error level', async () => {
  const errSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  try {
    await request(buildApp()).get('/throw-404');
    expect(errSpy).not.toHaveBeenCalled();
  } finally {
    errSpy.mockRestore();
  }
});

test('does NOT capture expected 4xx AppErrors', async () => {
  const res = await request(buildApp()).get('/throw-404');
  expect(res.status).toBe(404);
  expect(mockCapture).not.toHaveBeenCalled();
});

test('captures AppErrors with status >= 500', async () => {
  const res = await request(buildApp()).get('/throw-500-apperror');
  expect(res.status).toBe(503);
  expect(mockCapture).toHaveBeenCalledTimes(1);
});
