const mockInit = jest.fn();
const mockCapture = jest.fn();
jest.mock('@sentry/node', () => ({ init: mockInit, captureException: mockCapture }));

const loadFresh = () => {
  let mod;
  jest.isolateModules(() => { mod = require('./sentry'); });
  return mod;
};

const ENV_KEYS = ['SENTRY_DSN', 'SENTRY_TRACES_SAMPLE_RATE', 'RENDER_GIT_COMMIT', 'COMMIT_SHA', 'NODE_ENV'];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  mockInit.mockReset();
  mockCapture.mockReset();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('initSentry is a no-op when SENTRY_DSN is unset', () => {
  const { initSentry, captureError } = loadFresh();
  initSentry();
  captureError(new Error('boom'));
  expect(mockInit).not.toHaveBeenCalled();
  expect(mockCapture).not.toHaveBeenCalled();
});

test('initSentry configures dsn, environment, release and captureError forwards', () => {
  process.env.SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';
  process.env.NODE_ENV = 'production';
  process.env.RENDER_GIT_COMMIT = 'abc1234';
  const { initSentry, captureError } = loadFresh();
  initSentry();
  expect(mockInit).toHaveBeenCalledTimes(1);
  const opts = mockInit.mock.calls[0][0];
  expect(opts).toMatchObject({
    dsn: 'https://k@o.ingest.sentry.io/1',
    environment: 'production',
    release: 'abc1234',
    tracesSampleRate: 0,
  });
  const err = new Error('boom');
  captureError(err);
  expect(mockCapture).toHaveBeenCalledWith(err);
});

test('scrub removes the auth cookie and authorization header', () => {
  const { scrub } = loadFresh();
  const event = scrub({
    request: {
      cookies: { token: 'jwt' },
      headers: { authorization: 'Bearer x', Cookie: 'token=jwt', 'user-agent': 'ua' },
    },
  });
  expect(event.request.cookies).toBeUndefined();
  expect(event.request.headers.authorization).toBeUndefined();
  expect(event.request.headers.Cookie).toBeUndefined();
  expect(event.request.headers['user-agent']).toBe('ua');
});
