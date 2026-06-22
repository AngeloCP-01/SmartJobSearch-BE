module.exports = {
  testEnvironment: 'node',
  globalSetup: './tests/helpers/globalSetup.js',
  setupFiles: ['./tests/helpers/loadEnv.js'],
  testTimeout: 20000,
};
