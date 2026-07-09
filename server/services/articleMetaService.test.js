const test = require('node:test');
const assert = require('node:assert');
const { parseFrontmatter } = require('./articleMetaService');

test('parses simple scalar frontmatter', () => {
  const { data, body } = parseFrontmatter('---\ntitle: 叉积\ndate: 2024-10-31\n---\n正文');
  assert.strictEqual(data.title, '叉积');
  assert.strictEqual(data.date, '2024-10-31');
  assert.strictEqual(body, '正文');
});

test('strips quotes and BOM, supports CRLF', () => {
  const { data, body } = parseFrontmatter('﻿---\r\ntitle: "Hello"\r\n---\r\nbody');
  assert.strictEqual(data.title, 'Hello');
  assert.strictEqual(body, 'body');
});

test('collects list values under the active key', () => {
  const { data } = parseFrontmatter('---\ntags:\n- math\n- linear algebra\n---\n');
  assert.deepStrictEqual(data.tags, ['math', 'linear algebra']);
});

test('returns source unchanged without frontmatter', () => {
  const source = '# 标题\n正文';
  const { data, body } = parseFrontmatter(source);
  assert.deepStrictEqual(data, {});
  assert.strictEqual(body, source);
});

test('leaves unterminated frontmatter untouched', () => {
  const source = '---\ntitle: broken\n正文';
  const { data, body } = parseFrontmatter(source);
  assert.deepStrictEqual(data, {});
  assert.strictEqual(body, source);
});
