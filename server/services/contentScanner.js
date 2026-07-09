const fs = require('node:fs/promises');
const path = require('node:path');
const { NOTES_DIR } = require('../config');
const { readArticleMeta } = require('./articleMetaService');
const { stableHash } = require('../utils/stableHash');
const {
  compareContentNames,
  displayName,
  isArticleFile,
  isValidCategoryName
} = require('../utils/pathTools');

async function readSortedDir(absPath) {
  const entries = await fs.readdir(absPath, { withFileTypes: true });
  return entries.sort((a, b) => compareContentNames(a.name, b.name));
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

function compareArticles(a, b) {
  const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
  if (dateCompare !== 0) return dateCompare;
  return Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0);
}

async function scanContent(metaCache = new Map()) {
  await fs.mkdir(NOTES_DIR, { recursive: true });
  const latest = [];
  const nextMetaCache = new Map();

  async function readArticle(absPath, relativePath, categoryPath) {
    const stat = await fs.stat(absPath);
    const cached = metaCache.get(relativePath);

    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      nextMetaCache.set(relativePath, cached);
      return cached.article;
    }

    const article = await readArticleMeta(absPath, relativePath, categoryPath, stat);
    nextMetaCache.set(relativePath, { mtimeMs: stat.mtimeMs, size: stat.size, article });
    return article;
  }

  async function scanCategory(absDir, relativePath) {
    const entries = await readSortedDir(absDir);
    const childDirs = entries.filter(entry => entry.isDirectory() && isValidCategoryName(entry.name));
    const childNodes = [];

    for (const childDir of childDirs) {
      childNodes.push(await scanCategory(path.join(absDir, childDir.name), `${relativePath}/${childDir.name}`));
    }

    const isLeaf = childNodes.length === 0;
    let articleCount = 0;

    if (isLeaf) {
      const articleFiles = entries.filter(entry => entry.isFile() && isArticleFile(entry.name));
      for (const articleFile of articleFiles) {
        latest.push(await readArticle(
          path.join(absDir, articleFile.name),
          `${relativePath}/${articleFile.name}`,
          relativePath
        ));
      }
      articleCount = articleFiles.length;
    } else {
      articleCount = childNodes.reduce((sum, child) => sum + child.articleCount, 0);
    }

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

  const rootEntries = await readSortedDir(NOTES_DIR);
  const rootDirs = rootEntries.filter(entry => entry.isDirectory() && isValidCategoryName(entry.name));
  const tree = [];

  for (const rootDir of rootDirs) {
    tree.push(await scanCategory(path.join(NOTES_DIR, rootDir.name), `notes/${rootDir.name}`));
  }

  latest.sort(compareArticles);

  return {
    marker: markerForArticles(latest),
    tree,
    latest,
    totalArticles: latest.length,
    metaCache: nextMetaCache
  };
}

module.exports = { scanContent };
