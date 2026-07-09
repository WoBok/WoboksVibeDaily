const test = require('node:test');
const assert = require('node:assert');
const { PathGuardError, resolveContentPath, safeDecodeURIComponent } = require('./pathGuard');

function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    assert.ok(error instanceof PathGuardError, `expected PathGuardError, got ${error}`);
    return error.code;
  }
}

test('accepts a valid article path', () => {
  const { relativePath } = resolveContentPath('notes/0x0 - Inbox/文章.md');
  assert.strictEqual(relativePath, 'notes/0x0 - Inbox/文章.md');
});

test('normalizes backslashes and redundant segments', () => {
  const { relativePath } = resolveContentPath('notes\\0x0 - Inbox\\.\\a.md');
  assert.strictEqual(relativePath, 'notes/0x0 - Inbox/a.md');
});

test('rejects traversal outside notes', () => {
  assert.strictEqual(codeOf(() => resolveContentPath('../server/index.js')), 'PATH_TRAVERSAL');
  assert.strictEqual(codeOf(() => resolveContentPath('notes/0x0 - Inbox/../../package.json')), 'INVALID_CONTENT_PATH');
});

test('rejects paths outside the notes prefix', () => {
  assert.strictEqual(codeOf(() => resolveContentPath('server/index.js')), 'INVALID_CONTENT_PATH');
  assert.strictEqual(codeOf(() => resolveContentPath('')), 'INVALID_CONTENT_PATH');
});

test('rejects hidden files and directories', () => {
  assert.strictEqual(codeOf(() => resolveContentPath('notes/0x0 - Inbox/.secret.md')), 'PRIVATE_CONTENT');
  assert.strictEqual(codeOf(() => resolveContentPath('notes/.git/config')), 'PRIVATE_CONTENT');
});

test('rejects invalid category directory names', () => {
  assert.strictEqual(codeOf(() => resolveContentPath('notes/random/a.md')), 'INVALID_CATEGORY_PATH');
  assert.strictEqual(codeOf(() => resolveContentPath('notes/a.md')), 'INVALID_CATEGORY_PATH');
});

test('articleOnly restricts extensions', () => {
  assert.strictEqual(
    codeOf(() => resolveContentPath('notes/0x0 - Inbox/pic.png', { articleOnly: true })),
    'UNSUPPORTED_ARTICLE_TYPE'
  );
  const { relativePath } = resolveContentPath('notes/0x0 - Inbox/a.html', { articleOnly: true });
  assert.strictEqual(relativePath, 'notes/0x0 - Inbox/a.html');
});

test('safeDecodeURIComponent decodes once and flags malformed input', () => {
  assert.strictEqual(safeDecodeURIComponent('0x0%20-%20Inbox'), '0x0 - Inbox');
  assert.strictEqual(codeOf(() => safeDecodeURIComponent('%E4%')), 'MALFORMED_PATH');
});

test('percent characters survive after a single decode', () => {
  // 已解码路径中的 % 不再被二次解码（曾导致 500 的双重解码 bug）。
  const { relativePath } = resolveContentPath('notes/0x0 - Inbox/50%.md');
  assert.strictEqual(relativePath, 'notes/0x0 - Inbox/50%.md');
});
