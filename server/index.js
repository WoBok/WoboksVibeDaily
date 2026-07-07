'use strict';

/**
 * Node 服务入口（refactor-design §3 §7 §8 §14）。
 *
 * 单进程同时承担：
 *   - /api/*               → manifestRoutes / articleRoutes
 *   - /content/posts/*      → posts/ 静态文件（路径安全，屏蔽 _manifest.json）
 *   - /                      → 前端静态资源（index.html / app.js / style.css）
 *
 * 这样 `node server/index.js` 即可独立提供完整站点；
 * 生产环境再用 nginx 反代 /api 与 /content/posts，并直接发静态资源。
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { ROOT, POSTS_DIR, CONTENT_BASE, PORT, HOST } = require('./config');
const { sendJson, parseUrl, mimeFor } = require('./utils/http');
const guard = require('./utils/pathGuard');
const manifestRoutes = require('./routes/manifestRoutes');
const articleRoutes = require('./routes/articleRoutes');
const manifestService = require('./services/manifestService');
const watchService = require('./services/watchService');

const STATIC_WHITELIST = new Set(['/', '/index.html', '/app.js', '/style.css']);

// ---------- /content/posts/* 静态服务 ----------
async function serveContent(req, res, parsed) {
  const prefix = CONTENT_BASE + '/'; // /content/posts/
  if (!parsed.pathname.startsWith(prefix)) return false;

  const rest = decodeURIComponent(parsed.pathname.slice(prefix.length));
  const relPath = 'posts/' + rest;

  if (!guard.normalizeRelPath(relPath)) return send404(res);
  if (!guard.isUnderCategory(relPath)) return send404(res);
  if (guard.isManifestFile(relPath)) return send403(res); // 禁止外部访问 manifest
  if (!guard.isAllowedArticle(relPath)) return send404(res);

  const abs = guard.toAbs(relPath);
  if (!guard.withinPosts(abs)) return send404(res);

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch (e) {
    return send404(res);
  }
  if (!stat.isFile()) return send404(res);

  res.setHeader('Content-Type', mimeFor(abs));
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('ETag', `"${stat.size}-${Math.round(stat.mtimeMs)}"`);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  if (req.headers['if-none-match'] === `"${stat.size}-${Math.round(stat.mtimeMs)}"`) {
    res.statusCode = 304;
    return res.end();
  }
  fs.createReadStream(abs).pipe(res);
  return true;
}

// ---------- 前端静态资源 ----------
async function serveStatic(req, res, parsed) {
  let p = parsed.pathname;

  if (p === '/favicon.ico') {
    res.statusCode = 204;
    return res.end();
  }

  // SPA 兜底：未识别路径返回 index.html
  if (!STATIC_WHITELIST.has(p)) p = '/index.html';

  const fileMap = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/app.js': 'app.js',
    '/style.css': 'style.css',
  };
  const target = path.join(ROOT, fileMap[p]);
  try {
    const data = await fsp.readFile(target);
    res.setHeader('Content-Type', mimeFor(target));
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
    return true;
  } catch (e) {
    return send404(res);
  }
}

function send404(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  return true;
}
function send403(res) {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'FORBIDDEN' }));
  return true;
}

// ---------- 主请求处理 ----------
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  }

  const parsed = parseUrl(req);

  try {
    if (parsed.pathname.startsWith('/api/')) {
      if (await manifestRoutes.handle(req, res, parsed)) return;
      if (await articleRoutes.handle(req, res, parsed)) return;
      return send404(res);
    }
    if (await serveContent(req, res, parsed)) return;
    if (await serveStatic(req, res, parsed)) return;
    send404(res);
  } catch (err) {
    console.error('[server] unhandled error:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'INTERNAL' });
  }
});

// ---------- 启动 ----------
(async () => {
  try {
    console.log('[boot] building manifests...');
    await manifestService.init();
    console.log('[boot] manifests ready, starting watcher...');
    watchService.start();

    server.listen(PORT, HOST, () => {
      console.log(`\n  WoBok's Vibe Daily server`);
      console.log(`  → http://${HOST}:${PORT}`);
      console.log(`  → content root: ${POSTS_DIR}`);
      console.log(`  → api: /api/tree  /api/latest  /api/folder?path=  /api/article?path=`);
    });
  } catch (err) {
    console.error('[boot] failed:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', async () => {
  console.log('\n[boot] shutting down...');
  await watchService.stop();
  server.close(() => process.exit(0));
});
