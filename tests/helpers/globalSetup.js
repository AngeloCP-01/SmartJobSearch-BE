const { execSync } = require('child_process');

module.exports = async () => {
  require('dotenv').config({ path: '.env.test' });
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
};
