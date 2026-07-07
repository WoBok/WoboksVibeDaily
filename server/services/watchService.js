'use strict';

/**
 * 文件监听服务（refactor-design §7.4 §15.3）。
 *
 * - 只监听 posts 下 0x 分类目录中的 md / markdown / html 文件
 * - 忽略 _manifest.json 与 dotfile，避免写入 manifest 触发循环
 * - 文件事件按叶子目录 debounce，目录事件触发整树重建
 * - awaitWriteFinish 避免读到编辑器保存时的半写入文件
 */

const chokidar = require('chokidar');
const path = require('path');
const {
  POSTS_DIR,
  DEBOUNCE_MS,
  AWRITE_STABILITY_MS,
  AWRITE_POLL_MS,
} = require('../config');
const scanner = require('./contentScanner');
const manifestService = require('./manifestService');

const PROJECT_ROOT = path.resolve(POSTS_DIR, '..');
const POSTS_GLOB = POSTS_DIR.replace(/\\/g, '/');

const WATCH_PATTERNS = [
  `${POSTS_GLOB}/0x*/**/*.md`,
  `${POSTS_GLOB}/0x*/**/*.markdown`,
  `${POSTS_GLOB}/0x*/**/*.html`,
];

const IGNORED = [/_manifest\.json$/i, /(^|[/\\])\./];

let watcher = null;
const leafTimers = new Map();
let treeTimer = null;

function debounceLeaf(leafRel) {
  clearTimeout(leafTimers.get(leafRel));
  leafTimers.set(
    leafRel,
    setTimeout(() => {
      leafTimers.delete(leafRel);
      manifestService
        .onLeafChanged(leafRel)
        .then(() => console.log(`[watch] rebuilt leaf: ${leafRel}`))
        .catch((err) => console.error(`[watch] leaf rebuild failed (${leafRel}):`, err));
    }, DEBOUNCE_MS)
  );
}

function debounceTree() {
  clearTimeout(treeTimer);
  treeTimer = setTimeout(() => {
    treeTimer = null;
    manifestService
      .onTreeChanged()
      .then(() => console.log('[watch] rebuilt tree + root'))
      .catch((err) => console.error('[watch] tree rebuild failed:', err));
  }, DEBOUNCE_MS);
}

function absToRel(absPath) {
  return path.relative(PROJECT_ROOT, absPath).replace(/\\/g, '/');
}

function handleFile(absPath) {
  const rel = absToRel(absPath);
  if (!rel.startsWith('posts/')) return;
  const leafRel = scanner.leafOfArticle(rel);
  debounceLeaf(leafRel);
}

function start() {
  watcher = chokidar.watch(WATCH_PATTERNS, {
    ignoreInitial: true,
    ignored: IGNORED,
    awaitWriteFinish: {
      stabilityThreshold: AWRITE_STABILITY_MS,
      pollInterval: AWRITE_POLL_MS,
    },
    persistent: true,
  });

  watcher.on('add', handleFile);
  watcher.on('change', handleFile);
  watcher.on('unlink', handleFile);
  watcher.on('addDir', () => debounceTree());
  watcher.on('unlinkDir', () => debounceTree());
  watcher.on('error', (err) => console.error('[watch] error:', err));
  watcher.on('ready', () =>
    console.log('[watch] ready — watching posts/0x*/**/*.{md,markdown,html}')
  );
}

async function stop() {
  for (const t of leafTimers.values()) clearTimeout(t);
  leafTimers.clear();
  clearTimeout(treeTimer);
  if (watcher) await watcher.close();
}

module.exports = { start, stop };
