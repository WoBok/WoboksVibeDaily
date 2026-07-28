const fs = require('node:fs');
const path = require('node:path');
const { NOTES_DIR, ROOT_DIR } = require('../config');
const {
  ARTICLE_EXTENSIONS,
  fromPosix,
  isValidCategoryName,
  toPosix
} = require('./pathTools');

class PathGuardError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function assertInsideNotes(absPath) {
  const relative = path.relative(NOTES_DIR, absPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathGuardError('PATH_OUTSIDE_NOTES');
  }
}

function assertValidCategoryPath(relativePath) {
  const parts = toPosix(relativePath).split('/').filter(Boolean);
  if (parts[0] !== 'notes' || parts.length < 2) {
    throw new PathGuardError('INVALID_CONTENT_PATH');
  }

  // Only the first directory below notes/ is a category. Deeper directories
  // belong to that category and may contain article assets such as
  // assets/images/example.png.
  if (!isValidCategoryName(parts[1])) {
    throw new PathGuardError('INVALID_CATEGORY_PATH');
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    throw new PathGuardError('MALFORMED_PATH');
  }
}

function normalizeRelativePath(rawPath) {
  const posix = toPosix(String(rawPath || '')).replace(/^\/+/, '');
  const normalized = toPosix(path.posix.normalize(posix));

  if (normalized.includes('\0') || normalized === '..' || normalized.startsWith('../')) {
    throw new PathGuardError('PATH_TRAVERSAL');
  }

  if (!normalized.startsWith('notes/')) {
    throw new PathGuardError('INVALID_CONTENT_PATH');
  }

  if (normalized.split('/').some(part => part.startsWith('.'))) {
    throw new PathGuardError('PRIVATE_CONTENT');
  }

  return normalized;
}

function resolveContentPath(rawPath, options = {}) {
  const relativePath = normalizeRelativePath(rawPath);
  assertValidCategoryPath(relativePath);

  if (options.articleOnly) {
    const ext = path.extname(relativePath).toLowerCase();
    if (!ARTICLE_EXTENSIONS.has(ext)) {
      throw new PathGuardError('UNSUPPORTED_ARTICLE_TYPE');
    }
  }

  const absPath = path.resolve(ROOT_DIR, fromPosix(relativePath));
  assertInsideNotes(absPath);

  if (options.mustExist && !fs.existsSync(absPath)) {
    throw new PathGuardError('CONTENT_NOT_FOUND');
  }

  return { absPath, relativePath };
}

module.exports = {
  PathGuardError,
  resolveContentPath,
  safeDecodeURIComponent
};
