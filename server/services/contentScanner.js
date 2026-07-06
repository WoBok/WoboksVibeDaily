const fs = require('node:fs/promises');
const path = require('node:path');
const { POSTS_DIR } = require('../config');
const { readArticleMeta } = require('./articleMetaService');
const { stableHash } = require('../utils/stableHash');
const {
  compareContentNames,
  displayName,
  isArticleFile,
  isValidCategoryName,
  toPosix
} = require('../utils/pathTools');

async function ensurePostsRoot() {
  await fs.mkdir(POSTS_DIR, { recursive: true });
}

async function readSortedDir(absPath) {
  const entries = await fs.readdir(absPath, { withFileTypes: true });
  return entries.sort((a, b) => compareContentNames(a.name, b.name));
}

async function atomicWriteJson(absPath, data) {
  const tmpPath = `${absPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, absPath);
}

async function cleanupInvalidContent() {
  await ensurePostsRoot();
  const deleted = [];

  async function cleanDirectory(absDir, isRoot) {
    const entries = await readSortedDir(absDir);

    for (const entry of entries) {
      const absEntry = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (!isValidCategoryName(entry.name)) {
          await fs.rm(absEntry, { recursive: true, force: true });
          deleted.push(toPosix(path.relative(process.cwd(), absEntry)));
          continue;
        }

        await cleanDirectory(absEntry, false);
        continue;
      }

      if (isRoot && entry.name !== '_manifest.json') {
        await fs.rm(absEntry, { force: true });
        deleted.push(toPosix(path.relative(process.cwd(), absEntry)));
      }
    }
  }

  await cleanDirectory(POSTS_DIR, true);
  return deleted;
}

function markerForArticles(articles) {
  const signatureInput = articles
    .map(article => [
      article.path,
      article.format,
      article.title,
      article.date,
      article.summary,
      Math.round(article.mtimeMs),
      article.size
    ].join('|'))
    .join('\n');

  return {
    articleCount: articles.length,
    signature: `sha1:${stableHash(signatureInput)}`,
    generatedAt: new Date().toISOString()
  };
}

async function scanContent(options = {}) {
  await ensurePostsRoot();
  const deleted = options.cleanup ? await cleanupInvalidContent() : [];
  const latest = [];
  const leafManifests = [];
  const watchDirs = new Set([POSTS_DIR]);

  async function scanCategory(absDir, relativePath) {
    watchDirs.add(absDir);
    const entries = await readSortedDir(absDir);
    const childDirs = entries.filter(entry => entry.isDirectory() && isValidCategoryName(entry.name));
    const childNodes = [];

    for (const childDir of childDirs) {
      const childAbs = path.join(absDir, childDir.name);
      const childRelative = `${relativePath}/${childDir.name}`;
      childNodes.push(await scanCategory(childAbs, childRelative));
    }

    const isLeaf = childNodes.length === 0;
    const articles = [];

    if (isLeaf) {
      const articleFiles = entries.filter(entry => entry.isFile() && isArticleFile(entry.name));
      for (const articleFile of articleFiles) {
        const articleAbs = path.join(absDir, articleFile.name);
        const articleRelative = `${relativePath}/${articleFile.name}`;
        const article = await readArticleMeta(articleAbs, articleRelative, relativePath);
        articles.push(article);
        latest.push(article);
      }

      articles.sort(compareArticles);
      const leafManifest = {
        version: 1,
        type: 'leaf',
        folderName: path.basename(absDir),
        folderPath: relativePath,
        displayName: displayName(path.basename(absDir)),
        marker: markerForArticles(articles),
        articles
      };

      await atomicWriteJson(path.join(absDir, '_manifest.json'), leafManifest);
      leafManifests.push(leafManifest);
    }

    const articleCount = isLeaf
      ? articles.length
      : childNodes.reduce((sum, child) => sum + child.articleCount, 0);

    return {
      name: path.basename(absDir),
      path: relativePath,
      displayName: displayName(path.basename(absDir)),
      type: 'folder',
      isLeaf,
      articleCount,
      children: childNodes
    };
  }

  const rootEntries = await readSortedDir(POSTS_DIR);
  const rootDirs = rootEntries.filter(entry => entry.isDirectory() && isValidCategoryName(entry.name));
  const tree = [];

  for (const rootDir of rootDirs) {
    tree.push(await scanCategory(path.join(POSTS_DIR, rootDir.name), `posts/${rootDir.name}`));
  }

  latest.sort(compareArticles);

  const rootManifest = {
    version: 1,
    type: 'root',
    rootPath: 'posts',
    marker: markerForArticles(latest),
    tree,
    latest
  };

  await atomicWriteJson(path.join(POSTS_DIR, '_manifest.json'), rootManifest);

  return {
    rootManifest,
    leafManifests,
    latest,
    tree,
    totalArticles: latest.length,
    deleted,
    watchDirs: Array.from(watchDirs)
  };
}

function compareArticles(a, b) {
  const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
  if (dateCompare !== 0) return dateCompare;
  return Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0);
}

module.exports = {
  cleanupInvalidContent,
  scanContent
};
