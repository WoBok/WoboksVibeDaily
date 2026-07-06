const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT_DIR, 'posts');
const SERVER_PORT = Number(process.env.PORT || 55555);
const SERVER_HOST = process.env.HOST || '127.0.0.1';

module.exports = {
  ROOT_DIR,
  POSTS_DIR,
  SERVER_PORT,
  SERVER_HOST,
  CONTENT_URL_PREFIX: '/content/posts'
};
