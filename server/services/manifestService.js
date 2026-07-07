'use strict';

/**
 * manifest 服务（refactor-design §6 §7.5）。
 *
 * 策略（MVP，匹配 §15.1 §15.2 的建议）：
 *   - 启动时全量扫描一次，构建所有叶子 manifest 与根 manifest，并写入磁盘。
 *   - 启动后依赖 chokidar 文件事件维护内存缓存；文件变化时重建对应叶子与根。
 *   - API 请求直接读内存缓存；缓存缺失时即时重建。
 *   - marker（articleCount + signature）写入 manifest 供后续校验与排查使用。
 *   - manifest 写入采用「临时文件 + rename」原子写，并串行化避免并发冲突。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const {
  POSTS_DIR,
  POSTS_REL,
  MANIFEST_NAME,
  MANIFEST_VERSION,
  CONTENT_BASE,
} = require('../config');
const scanner = require('./contentScanner');
const metaService = require('./articleMetaService');
const guard = require('../utils/pathGuard');
const hash = require('../utils/stableHash');

const leafCache = new Map(); // leafRelPath -> leaf manifest
let rootCache = null; // root manifest

// ---------- 工具 ----------

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 对外暴露的文章对象（去掉内部 signature 等字段） */
function publicArticle(a) {
  return {
    path: a.path,
    format: a.format,
    title: a.title,
    date: a.date,
    summary: a.summary,
    categoryPath: a.categoryPath,
    categoryName: a.categoryName,
    mtimeMs: a.mtimeMs,
  };
}

function fileFormat(name) {
  const ext = path.extname(name).toLowerCase();
  return ext === '.html' ? 'html' : 'markdown';
}

function contentUrl(relPath, mtimeMs) {
  const rest = relPath.startsWith(POSTS_REL + '/')
    ? relPath.slice(POSTS_REL.length + 1)
    : relPath;
  const enc = rest.split('/').map(encodeURIComponent).join('/');
  return `${CONTENT_BASE}/${enc}?v=${mtimeMs}`;
}

// ---------- 串行写入队列 ----------

let writeChain = Promise.resolve();
function enqueue(task) {
  const next = writeChain.then(() => task());
  writeChain = next.catch(() => {});
  return next;
}

async function atomicWriteJson(abs, obj) {
  await enqueue(async () => {
    const data = JSON.stringify(obj, null, 2);
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, data, 'utf8');
    await fsp.rename(tmp, abs);
  });
}

function leafManifestAbs(leafRel) {
  return path.join(POSTS_DIR, scanner.relToPostsChild(leafRel), MANIFEST_NAME);
}
function rootManifestAbs() {
  return path.join(POSTS_DIR, MANIFEST_NAME);
}

// ---------- 构建 ----------

async function buildLeaf(leafRel) {
  const files = await scanner.listLeafArticleFiles(leafRel);
  const folderName = path.basename(leafRel);
  const displayName = scanner.displayName(folderName);
  const articles = [];

  for (const f of files) {
    const stat = await fsp.stat(f.abs);
    const format = fileFormat(f.name);
    const text = await fsp.readFile(f.abs, 'utf8');
    const meta =
      format === 'html'
        ? metaService.extractHtmlMeta(text, f.name)
        : metaService.extractMarkdownMeta(text, f.name);

    const date = meta.date || formatDate(new Date(stat.mtimeMs));
    const category = meta.category || displayName;

    articles.push({
      id: f.rel,
      path: f.rel,
      format,
      title: meta.title,
      date,
      summary: meta.summary,
      tags: meta.tags || [],
      categoryPath: leafRel,
      categoryName: category === displayName ? displayName : category,
      mtimeMs: Math.round(stat.mtimeMs),
      size: stat.size,
      signature: hash.articleSignature({
        relativePath: f.rel,
        size: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
        fileType: format,
      }),
    });
  }

  const manifest = {
    version: MANIFEST_VERSION,
    type: 'leaf',
    folderName,
    folderPath: leafRel,
    displayName,
    marker: {
      articleCount: articles.length,
      signature: hash.folderSignature(articles),
      generatedAt: new Date().toISOString(),
    },
    articles,
  };

  await atomicWriteJson(leafManifestAbs(leafRel), manifest);
  leafCache.set(leafRel, manifest);
  return manifest;
}

async function buildRoot() {
  const tree = await scanner.buildTree();
  const leaves = scanner.collectLeaves(tree);
  const allArticles = [];
  const leafSigs = [];

  for (const leaf of leaves) {
    const lm = await ensureLeafBuilt(leaf.path);
    leaf.articleCount = lm.articles.length;
    leafSigs.push(lm.marker.signature);
    allArticles.push(...lm.articles);
  }

  // latest：date desc，同一天按 mtimeMs desc
  const sorted = allArticles.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.mtimeMs || 0) - (a.mtimeMs || 0);
  });

  const rootManifest = {
    version: MANIFEST_VERSION,
    type: 'root',
    rootPath: POSTS_REL,
    marker: {
      articleCount: sorted.length,
      signature: 'sha1:' + hash.sha1(leafSigs.sort().join('|')),
      generatedAt: new Date().toISOString(),
    },
    tree,
    latest: sorted.map(publicArticle),
  };

  await atomicWriteJson(rootManifestAbs(), rootManifest);
  rootCache = rootManifest;
  return rootManifest;
}

// ---------- 读取（带缓存） ----------

async function ensureLeafBuilt(leafRel) {
  const cached = leafCache.get(leafRel);
  if (cached) return cached;
  return buildLeaf(leafRel);
}

async function ensureRoot() {
  if (rootCache) return rootCache;
  return buildRoot();
}

// ---------- 对外 API ----------

async function getTree() {
  const root = await ensureRoot();
  return { tree: root.tree, totalArticles: root.marker.articleCount };
}

async function getLatest(limit) {
  const root = await ensureRoot();
  const list = root.latest;
  return limit && limit > 0 ? list.slice(0, limit) : list;
}

async function getFolder(leafRel) {
  if (!guard.isUnderCategory(leafRel)) return { error: 'NOT_LEAF_FOLDER' };
  const abs = path.join(POSTS_DIR, scanner.relToPostsChild(leafRel));
  const st = await scanner.statOrNull(abs);
  if (!st || !st.isDirectory()) return { error: 'NOT_FOUND' };

  const isLeaf = await scanner.isLeafDir(leafRel);
  if (!isLeaf) return { error: 'NOT_LEAF_FOLDER' };

  const lm = await ensureLeafBuilt(leafRel);
  return {
    folder: {
      name: lm.folderName,
      path: lm.folderPath,
      displayName: lm.displayName,
      isLeaf: true,
      articleCount: lm.articles.length,
    },
    articles: lm.articles.map(publicArticle),
  };
}

async function getArticle(relPath) {
  if (!guard.normalizeRelPath(relPath)) return null;
  if (!guard.isUnderCategory(relPath) || !guard.isAllowedArticle(relPath)) return null;

  const leafRel = scanner.leafOfArticle(relPath);
  const leafAbs = path.join(POSTS_DIR, scanner.relToPostsChild(leafRel));
  const st = await scanner.statOrNull(leafAbs);
  if (!st || !st.isDirectory()) return null;

  const leafIsLeaf = await scanner.isLeafDir(leafRel);
  if (!leafIsLeaf) return null; // 非叶子目录中的文章被忽略

  const lm = await ensureLeafBuilt(leafRel);
  const article = lm.articles.find((a) => a.path === relPath);
  if (!article) return null;

  const pub = publicArticle(article);

  if (article.format === 'html') {
    return { article: pub, content: { url: contentUrl(relPath, article.mtimeMs) } };
  }

  // markdown：返回原文（含 frontmatter，前端自行剥离）
  const abs = guard.toAbs(relPath);
  if (!guard.withinPosts(abs)) return null;
  const text = await fsp.readFile(abs, 'utf8');
  return { article: pub, content: { markdown: text } };
}

// ---------- 文件变化回调（由 watchService 调用） ----------

async function onLeafChanged(leafRel) {
  await buildLeaf(leafRel);
  await buildRoot();
}

async function onTreeChanged() {
  rootCache = null;
  leafCache.clear();
  await buildRoot();
}

// ---------- 启动初始化 ----------

async function init() {
  await buildRoot();
}

module.exports = {
  init,
  getTree,
  getLatest,
  getFolder,
  getArticle,
  onLeafChanged,
  onTreeChanged,
};
