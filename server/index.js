const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const {
  CONTENT_URL_PREFIX,
  ROOT_DIR,
  SERVER_HOST,
  SERVER_PORT
} = require('./config');
const { ManifestService } = require('./services/manifestService');
const { createWatchService } = require('./services/watchService');
const { PathGuardError, resolveContentPath, safeDecodeURIComponent } = require('./utils/pathGuard');
const { encodeContentUrl } = require('./utils/pathTools');

const manifestService = new ManifestService();
const shouldWatch = process.env.WATCH !== '0';
const TEMPLATE_URL_PREFIX = '/templates';
const TEMPLATE_DIR = path.join(ROOT_DIR, 'notes', 'Templates');
const CODE_BROWSER_MAX_FILES = 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
}

function notFound(res) {
  send(res, 404, 'Not Found', {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
}

function errorResponse(res, error) {
  if (error instanceof PathGuardError) {
    sendJson(res, 400, { error: error.code });
    return;
  }

  console.error(error);
  sendJson(res, 500, { error: 'INTERNAL_SERVER_ERROR' });
}

function cacheControlFor(requestUrl) {
  // 带 ?v= 版本号的资源内容不可变，可长缓存；其余走协商缓存。
  return requestUrl.searchParams.has('v')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

async function serveFile(res, absPath, options = {}) {
  const stat = await fsp.stat(absPath);
  if (!stat.isFile()) {
    notFound(res);
    return;
  }

  const ext = path.extname(absPath).toLowerCase();
  const etag = `"${stat.size}-${Math.round(stat.mtimeMs)}"`;
  const headers = {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Last-Modified': stat.mtime.toUTCString(),
    ETag: etag,
    'Cache-Control': options.cacheControl || 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  };

  if (options.ifNoneMatch && options.ifNoneMatch === etag) {
    send(res, 304, '', headers);
    return;
  }

  const stream = fs.createReadStream(absPath);
  stream.on('error', error => {
    console.error(`[serve] stream error for ${absPath}:`, error.message);
    res.destroy(error);
  });
  res.writeHead(200, headers);
  stream.pipe(res);
}

async function handleApi(req, res, requestUrl) {
  const pathname = requestUrl.pathname;
  const index = manifestService.getIndex();

  if (pathname === '/api/tree') {
    sendJson(res, 200, {
      tree: index.tree,
      totalArticles: index.marker.articleCount
    });
    return;
  }

  if (pathname === '/api/latest') {
    const limit = Math.max(0, Number(requestUrl.searchParams.get('limit') || 0));
    const offset = Math.max(0, Number(requestUrl.searchParams.get('offset') || 0));
    const list = limit > 0 ? index.latest.slice(offset, offset + limit) : index.latest.slice(offset);
    sendJson(res, 200, { articles: list, totalArticles: index.marker.articleCount });
    return;
  }

  if (pathname === '/api/timeline') {
    sendJson(res, 200, { months: manifestService.getTimelineMonths() });
    return;
  }

  if (pathname === '/api/timeline/month') {
    const result = manifestService.findArticlesByMonth(requestUrl.searchParams.get('month') || '');

    if (!result) {
      sendJson(res, 400, { error: 'INVALID_MONTH' });
      return;
    }

    sendJson(res, 200, result);
    return;
  }

  if (pathname === '/api/folder') {
    const rawPath = requestUrl.searchParams.get('path') || '';
    const { relativePath } = resolveContentPath(rawPath);
    const folder = manifestService.findFolder(relativePath);

    if (!folder) {
      sendJson(res, 404, { error: 'FOLDER_NOT_FOUND' });
      return;
    }

    if (!folder.isLeaf) {
      sendJson(res, 400, { error: 'NOT_LEAF_FOLDER' });
      return;
    }

    const articles = index.latest.filter(article => article.categoryPath === folder.path);
    sendJson(res, 200, { folder, articles });
    return;
  }

  if (pathname === '/api/article') {
    const rawPath = requestUrl.searchParams.get('path') || '';
    const { absPath, relativePath } = resolveContentPath(rawPath, { articleOnly: true, mustExist: true });
    const article = manifestService.findArticle(relativePath);

    if (!article) {
      sendJson(res, 404, { error: 'ARTICLE_NOT_FOUND' });
      return;
    }

    if (article.format === 'markdown') {
      const markdown = await fsp.readFile(absPath, 'utf8');
      sendJson(res, 200, {
        article,
        content: { markdown }
      });
      return;
    }

    sendJson(res, 200, {
      article,
      content: {
        url: encodeContentUrl(article.path, article.mtimeMs)
      }
    });
    return;
  }

  if (pathname === '/api/code-browser') {
    const articlePath = requestUrl.searchParams.get('article') || '';
    sendJson(res, 200, await scanCodeBrowserProject(articlePath));
    return;
  }

  if (pathname === '/api/rebuild' && req.method === 'POST') {
    req.resume();
    const result = await manifestService.rebuild();
    sendJson(res, 200, {
      totalArticles: result.totalArticles,
      generatedAt: result.marker.generatedAt
    });
    return;
  }

  notFound(res);
}

async function handleContent(req, res, requestUrl) {
  const bodyPath = safeDecodeURIComponent(requestUrl.pathname.slice(`${CONTENT_URL_PREFIX}/`.length));
  const { absPath } = resolveContentPath(`notes/${bodyPath}`, { mustExist: true });

  await serveFile(res, absPath, {
    ifNoneMatch: req.headers['if-none-match'],
    cacheControl: cacheControlFor(requestUrl)
  });
}

async function scanCodeBrowserProject(rawArticlePath) {
  const { relativePath: articlePath } = resolveContentPath(rawArticlePath, {
    articleOnly: true,
    mustExist: true
  });
  const article = manifestService.findArticle(articlePath);
  if (!article || article.format !== 'html') {
    throw new PathGuardError('CODE_BROWSER_ARTICLE_NOT_FOUND');
  }

  const articleName = path.posix.basename(articlePath, path.posix.extname(articlePath));
  const directoryName = `code - ${articleName}`;
  const directoryPath = path.posix.join(path.posix.dirname(articlePath), directoryName);
  const { absPath: directoryAbsPath } = resolveContentPath(directoryPath);
  const files = [];
  let exists = true;
  let truncated = false;

  try {
    const stat = await fsp.stat(directoryAbsPath);
    if (!stat.isDirectory()) exists = false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    exists = false;
  }

  async function walk(absDir, relativeDir = '') {
    const entries = (await fsp.readdir(absDir, { withFileTypes: true }))
      .filter(entry => !entry.name.startsWith('.') && !entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }));

    for (const entry of entries) {
      if (files.length >= CODE_BROWSER_MAX_FILES) {
        truncated = true;
        return;
      }

      const relativeFilePath = path.posix.join(relativeDir, entry.name);
      const absEntryPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absEntryPath, relativeFilePath);
        if (truncated) return;
      } else if (entry.isFile()) {
        const stat = await fsp.stat(absEntryPath);
        files.push({
          path: relativeFilePath,
          name: entry.name,
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
          url: encodeContentUrl(path.posix.join(directoryPath, relativeFilePath), stat.mtimeMs)
        });
      }
    }
  }

  if (exists) await walk(directoryAbsPath);
  return { articlePath, directoryName, directoryPath, exists, truncated, files };
}

async function resolveTemplateFile(rawPath) {
  const normalized = path.posix
    .normalize(String(rawPath || '').replace(/\\/g, '/'))
    .replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);

  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('\0')
    || parts.some(part => part.startsWith('.'))
  ) {
    throw new PathGuardError('INVALID_TEMPLATE_PATH');
  }

  const candidate = path.resolve(TEMPLATE_DIR, normalized.split('/').join(path.sep));
  const relative = path.relative(TEMPLATE_DIR, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathGuardError('INVALID_TEMPLATE_PATH');
  }

  const [realRoot, realFile] = await Promise.all([
    fsp.realpath(TEMPLATE_DIR),
    fsp.realpath(candidate)
  ]);
  const realRelative = path.relative(realRoot, realFile);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new PathGuardError('INVALID_TEMPLATE_PATH');
  }

  return realFile;
}

async function handleTemplate(req, res, requestUrl) {
  const bodyPath = safeDecodeURIComponent(requestUrl.pathname.slice(`${TEMPLATE_URL_PREFIX}/`.length));
  const absPath = await resolveTemplateFile(bodyPath);

  await serveFile(res, absPath, {
    ifNoneMatch: req.headers['if-none-match'],
    cacheControl: cacheControlFor(requestUrl)
  });
}

async function handleStatic(req, res, requestUrl) {
  let pathname = safeDecodeURIComponent(requestUrl.pathname);
  if (pathname === '/') pathname = '/index.html';

  const allowedRootFiles = new Set(['/index.html', '/app.js', '/style.css', '/favicon.ico']);
  if (!allowedRootFiles.has(pathname)) {
    pathname = '/index.html';
  }

  await serveFile(res, path.join(ROOT_DIR, pathname), {
    ifNoneMatch: req.headers['if-none-match'],
    cacheControl: pathname === '/index.html' ? 'no-cache' : cacheControlFor(requestUrl)
  });
}

async function requestHandler(req, res) {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${SERVER_HOST}:${SERVER_PORT}`}`);

    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApi(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith(`${CONTENT_URL_PREFIX}/`)) {
      await handleContent(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith(`${TEMPLATE_URL_PREFIX}/`)) {
      await handleTemplate(req, res, requestUrl);
      return;
    }

    await handleStatic(req, res, requestUrl);
  } catch (error) {
    if (error.code === 'ENOENT') {
      notFound(res);
      return;
    }
    errorResponse(res, error);
  }
}

async function start() {
  const result = await manifestService.init();
  console.log(`[manifest] ready: ${result.totalArticles} articles`);

  const watchService = createWatchService(manifestService);
  if (shouldWatch) watchService.start();

  const server = http.createServer(requestHandler);
  server.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`[server] http://${SERVER_HOST}:${SERVER_PORT}`);
  });

  const shutdown = () => {
    watchService.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { requestHandler, start };
