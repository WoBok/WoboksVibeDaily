'use strict';

const path = require('path');
const { POSTS_DIR, ARTICLE_EXT, CATEGORY_PREFIX } = require('../config');

/**
 * 把外部传入的 path 规范化为相对项目根的 POSIX 路径，例如
 *   "posts/0x0 - Inbox/note.md"  ->  "posts/0x0 - Inbox/note.md"
 * 返回 null 表示非法。
 *
 * 校验规则（refactor-design §7.3）：
 *   - 必须以 posts/ 开头（或恰好是 posts）
 *   - 禁止 .. 路径穿越
 *   - 不允许绝对路径
 */
function normalizeRelPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let p = raw.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  if (!p) return null;

  const low = p.toLowerCase();
  if (low !== 'posts' && !low.startsWith('posts/')) return null;

  const parts = p.split('/');
  if (parts.some((seg) => seg === '..' || seg === '.')) return null;
  if (path.isAbsolute(p)) return null;

  return p;
}

/** 相对路径 -> 绝对路径（基于项目根） */
function toAbs(relPath) {
  const root = path.resolve(POSTS_DIR, '..');
  return path.resolve(root, relPath);
}

/** 绝对路径是否落在 POSTS_DIR 内部 */
function withinPosts(absPath) {
  const rel = path.relative(POSTS_DIR, absPath);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 相对路径是否位于有效的 0x 分类目录下（posts/0x.../...） */
function isUnderCategory(relPath) {
  const parts = relPath.split('/');
  // parts[0] = 'posts'，parts[1] 必须是 0x 开头的分类目录
  return parts.length >= 2 && parts[1].startsWith(CATEGORY_PREFIX);
}

function isAllowedArticle(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  return ARTICLE_EXT.includes(ext);
}

function isManifestFile(relPath) {
  return path.basename(relPath) === '_manifest.json';
}

module.exports = {
  normalizeRelPath,
  toAbs,
  withinPosts,
  isUnderCategory,
  isAllowedArticle,
  isManifestFile,
};
