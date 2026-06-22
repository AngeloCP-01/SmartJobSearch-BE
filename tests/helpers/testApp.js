const request = require('supertest');
const app = require('../../src/app');

const agent = () => request(app);

module.exports = { app, agent };
