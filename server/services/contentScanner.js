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
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  try {
    const current = await fs.readFile(absPath, 'utf8');
    if (current === serialized) return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const tmpPath = `${absPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, serialized, 'utf8');

  try {
    await renameWithRetry(tmpPath, absPath);
    return true;
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function renameWithRetry(tmpPath, absPath) {
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY']);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rename(tmpPath, absPath);
      return;
    } catch (error) {
      if (!retryable.has(error.code) || attempt === 5) throw error;
      await wait(60 * (attempt + 1));
    }
  }
}

async function readManifestJson(absPath) {
  try {
    return JSON.parse(await fs.readFile(absPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function preserveGeneratedAt(absPath, manifest) {
  const current = await readManifestJson(absPath);
  if (!current?.marker || !manifest?.marker) return;

  if (
    current.marker.signature === manifest.marker.signature
    && current.marker.articleCount === manifest.marker.articleCount
  ) {
    manifest.marker.generatedAt = current.marker.generatedAt || manifest.marker.generatedAt;
  }
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

      const leafManifestPath = path.join(absDir, '_manifest.json');
      await preserveGeneratedAt(leafManifestPath, leafManifest);
      await atomicWriteJson(leafManifestPath, leafManifest);
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

  const rootManifestPath = path.join(POSTS_DIR, '_manifest.json');
  await preserveGeneratedAt(rootManifestPath, rootManifest);
  await atomicWriteJson(rootManifestPath, rootManifest);

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
