const { PassThrough } = require('stream');
const pino = require('pino');

// The module reads NODE_ENV at require time; Jest sets NODE_ENV=test.
const loadFresh = () => {
  let mod;
  jest.isolateModules(() => { mod = require('./logger'); });
  return mod;
};

test('logger level is silent under NODE_ENV=test', () => {
  const { logger } = loadFresh();
  expect(logger.level).toBe('silent');
});

test('genReqId generates a uuid and sets the X-Request-Id response header', () => {
  const { genReqId } = loadFresh();
  const setHeader = jest.fn();
  const id = genReqId({ headers: {} }, { setHeader });
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(setHeader).toHaveBeenCalledWith('X-Request-Id', id);
});

test('genReqId honors an inbound x-request-id header', () => {
  const { genReqId } = loadFresh();
  const setHeader = jest.fn();
  const id = genReqId({ headers: { 'x-request-id': 'trace-abc' } }, { setHeader });
  expect(id).toBe('trace-abc');
  expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'trace-abc');
});

test('REDACT removes authorization and cookie from logged requests', (done) => {
  const { REDACT } = loadFresh();
  const sink = new PassThrough();
  let out = '';
  sink.on('data', (c) => { out += c.toString(); });
  const testLogger = pino({ level: 'info', redact: REDACT }, sink);
  testLogger.info({ req: { headers: { authorization: 'Bearer secret', cookie: 'sid=xyz', 'user-agent': 'x' } } }, 'req');
  setImmediate(() => {
    expect(out).not.toContain('Bearer secret');
    expect(out).not.toContain('sid=xyz');
    expect(out).toContain('user-agent');
    done();
  });
});

test('REDACT removes the Set-Cookie response header (refresh token) from logs', (done) => {
  const { REDACT } = loadFresh();
  const sink = new PassThrough();
  let out = '';
  sink.on('data', (c) => { out += c.toString(); });
  const testLogger = pino({ level: 'info', redact: REDACT }, sink);
  testLogger.info({ res: { headers: { 'set-cookie': 'refreshToken=SECRET_JWT; HttpOnly', 'content-type': 'application/json' } } }, 'res');
  setImmediate(() => {
    expect(out).not.toContain('SECRET_JWT');
    expect(out).toContain('content-type');
    done();
  });
});
