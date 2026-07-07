'use strict';

/**
 * 内容扫描器（refactor-design §4 §7.1）。
 * 只扫描 posts/ 下 0x 开头的分类目录；只把叶子目录中的文章纳入索引。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const {
  POSTS_DIR,
  POSTS_REL,
  ARTICLE_EXT,
  MANIFEST_NAME,
  CATEGORY_PREFIX,
} = require('../config');

function isCategoryDir(name) {
  return name.startsWith(CATEGORY_PREFIX);
}

/** 0xN - Name -> Name */
function displayName(name) {
  return name.replace(/^0x[0-9A-Fa-f]+\s*-\s*/, '').trim() || name;
}

function isArticleFile(name) {
  const ext = path.extname(name).toLowerCase();
  return ARTICLE_EXT.includes(ext) && name !== MANIFEST_NAME;
}

/** 异步读取目录（容错：不存在返回 []） */
async function safeReaddir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
}

async function statOrNull(p) {
  try {
    return await fsp.stat(p);
  } catch (e) {
    return null;
  }
}

/**
 * 递归构建 0x 分类目录树。
 * 返回节点结构：
 *   { name, path, displayName, type:'folder', isLeaf, articleCount, children:[] }
 * articleCount = 后代叶子中的文章总数（叶子为自身直接文章数）。
 */
async function buildTree() {
  const root = await buildNode(POSTS_DIR, POSTS_REL);
  return root ? root.children : [];
}

async function buildNode(absDir, relDir) {
  const name = path.basename(relDir);
  const entries = await safeReaddir(absDir);

  const subFolders = entries.filter(
    (e) => e.isDirectory() && isCategoryDir(e.name)
  );

  const isLeaf = subFolders.length === 0;

  let articleCount = 0;
  const children = [];

  if (isLeaf) {
    articleCount = entries.filter(
      (e) => e.isFile() && isArticleFile(e.name)
    ).length;
  } else {
    for (const sub of subFolders) {
      const childAbs = path.join(absDir, sub.name);
      const childRel = `${relDir}/${sub.name}`;
      const child = await buildNode(childAbs, childRel);
      if (child) {
        children.push(child);
        articleCount += child.articleCount;
      }
    }
  }

  return {
    name,
    path: relDir,
    displayName: displayName(name),
    type: 'folder',
    isLeaf,
    articleCount,
    children,
  };
}

/**
 * 列出某叶子目录中直接包含的文章文件名（不含 _manifest.json）。
 * 返回 [{ name, abs, rel }]，按文件名排序。
 */
async function listLeafArticleFiles(leafRelPath) {
  const abs = path.join(POSTS_DIR, relToPostsChild(leafRelPath));
  const entries = await safeReaddir(abs);
  return entries
    .filter((e) => e.isFile() && isArticleFile(e.name))
    .map((e) => ({
      name: e.name,
      abs: path.join(abs, e.name),
      rel: `${leafRelPath}/${e.name}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/** 'posts/0x0 - Inbox' -> '0x0 - Inbox' */
function relToPostsChild(relPath) {
  return relPath.startsWith(`${POSTS_REL}/`)
    ? relPath.slice(POSTS_REL.length + 1)
    : '';
}

/** 给定文章相对路径，返回其所在叶子目录的相对路径。 */
function leafOfArticle(articleRelPath) {
  const idx = articleRelPath.lastIndexOf('/');
  return idx > 0 ? articleRelPath.slice(0, idx) : POSTS_REL;
}

/**
 * 判断某目录是否为叶子目录（无 0x 子目录）。
 */
async function isLeafDir(relDirPath) {
  const abs = path.join(POSTS_DIR, relToPostsChild(relDirPath));
  const entries = await safeReaddir(abs);
  return !entries.some((e) => e.isDirectory() && isCategoryDir(e.name));
}

/**
 * 在整棵树中查找某路径节点。
 */
function findNode(tree, relPath) {
  if (!relPath || relPath === POSTS_REL) return null;
  const parts = relPath.split('/').filter(Boolean); // ['posts', '0x0 - Inbox', ...]
  if (parts[0] !== POSTS_REL) return null;
  let nodes = tree;
  let node = null;
  for (let i = 1; i < parts.length; i++) {
    node = nodes.find((n) => n.name === parts[i]);
    if (!node) return null;
    nodes = node.children;
  }
  return node;
}

/** 收集树中所有叶子节点 */
function collectLeaves(nodes, acc = []) {
  for (const n of nodes) {
    if (n.isLeaf) acc.push(n);
    else collectLeaves(n.children, acc);
  }
  return acc;
}

module.exports = {
  buildTree,
  listLeafArticleFiles,
  leafOfArticle,
  isLeafDir,
  findNode,
  collectLeaves,
  displayName,
  isArticleFile,
  isCategoryDir,
  statOrNull,
  relToPostsChild,
};
