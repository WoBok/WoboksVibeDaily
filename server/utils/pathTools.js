const path = require('node:path');

const ARTICLE_EXTENSIONS = new Set(['.md', '.markdown', '.html']);

function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

function fromPosix(value) {
  return String(value).split('/').join(path.sep);
}

function isArticleFile(fileName) {
  return ARTICLE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function articleFormat(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.html') return 'html';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  return 'unknown';
}

function isValidCategoryName(name) {
  return /^0x[0-9a-f]+(?:\b|[\s-])/i.test(name);
}

function displayName(name) {
  return name.replace(/^0x[0-9a-f]+\s*-\s*/i, '').trim() || name;
}

function titleFromFileName(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/^\d{4}-\d{2}-\d{2}[-_ ]?/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function compareContentNames(a, b) {
  return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function encodeContentUrl(relativeArticlePath, mtimeMs) {
  const posixPath = toPosix(relativeArticlePath);
  const body = posixPath.replace(/^posts\//, '');
  const encoded = body.split('/').map(encodeURIComponent).join('/');
  return `/content/posts/${encoded}?v=${Math.round(mtimeMs)}`;
}

module.exports = {
  ARTICLE_EXTENSIONS,
  toPosix,
  fromPosix,
  isArticleFile,
  articleFormat,
  isValidCategoryName,
  displayName,
  titleFromFileName,
  compareContentNames,
  encodeContentUrl
};
