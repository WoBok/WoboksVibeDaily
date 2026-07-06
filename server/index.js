const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const {
  CONTENT_URL_PREFIX,
  POSTS_DIR,
  ROOT_DIR,
  SERVER_HOST,
  SERVER_PORT
} = require('./config');
const { ManifestService } = require('./services/manifestService');
const { createWatchService } = require('./services/watchService');
const { PathGuardError, resolveContentPath } = require('./utils/pathGuard');
const { encodeContentUrl } = require('./utils/pathTools');

const manifestService = new ManifestService();
const shouldWatch = process.argv.includes('--watch') || process.env.WATCH !== '0';

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
  res.writeHead(status, headers);
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

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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
    'Cache-Control': options.cacheControl || 'no-cache'
  };

  if (options.ifNoneMatch && options.ifNoneMatch === etag) {
    send(res, 304, '', headers);
    return;
  }

  const stream = fs.createReadStream(absPath);
  res.writeHead(200, headers);
  stream.pipe(res);
}

async function handleApi(req, res, requestUrl) {
  const pathname = requestUrl.pathname;
  const root = manifestService.getRootManifest();

  if (pathname === '/api/tree') {
    sendJson(res, 200, {
      tree: root.tree,
      totalArticles: root.marker.articleCount
    });
    return;
  }

  if (pathname === '/api/latest') {
    const limit = Math.max(0, Number(requestUrl.searchParams.get('limit') || 0));
    const offset = Math.max(0, Number(requestUrl.searchParams.get('offset') || 0));
    const list = limit > 0 ? root.latest.slice(offset, offset + limit) : root.latest.slice(offset);
    sendJson(res, 200, { articles: list, totalArticles: root.marker.articleCount });
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

    const articles = root.latest
      .filter(article => article.categoryPath === folder.path)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.mtimeMs - a.mtimeMs);

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

  if (pathname === '/api/rebuild' && req.method === 'POST') {
    await readRequestBody(req);
    const result = await manifestService.rebuild({ cleanup: false });
    sendJson(res, 200, {
      totalArticles: result.totalArticles,
      generatedAt: result.rootManifest.marker.generatedAt
    });
    return;
  }

  notFound(res);
}

async function handleContent(req, res, requestUrl) {
  const bodyPath = decodeURIComponent(requestUrl.pathname.slice(`${CONTENT_URL_PREFIX}/`.length));
  const { absPath } = resolveContentPath(`posts/${bodyPath}`, { mustExist: true });

  if (absPath.endsWith('_manifest.json') || !absPath.startsWith(POSTS_DIR)) {
    notFound(res);
    return;
  }

  await serveFile(res, absPath, {
    ifNoneMatch: req.headers['if-none-match'],
    cacheControl: 'no-cache'
  });
}

async function handleStatic(req, res, requestUrl) {
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === '/') pathname = '/index.html';

  const allowedRootFiles = new Set(['/index.html', '/app.js', '/style.css', '/favicon.ico']);
  if (!allowedRootFiles.has(pathname)) {
    pathname = '/index.html';
  }

  const absPath = path.resolve(ROOT_DIR, `.${pathname}`);
  if (!absPath.startsWith(ROOT_DIR)) {
    notFound(res);
    return;
  }

  await serveFile(res, absPath, {
    ifNoneMatch: req.headers['if-none-match'],
    cacheControl: pathname === '/index.html' ? 'no-cache' : 'no-cache'
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
  const result = await manifestService.init({ cleanup: false });
  console.log(`[manifest] ready: ${result.totalArticles} articles`);

  const watchService = createWatchService(manifestService);
  if (shouldWatch) await watchService.start();

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
