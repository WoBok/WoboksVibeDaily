'use strict';

/** 轻量 HTTP 工具。 */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.end(body);
}

function parseUrl(req) {
  const u = new URL(req.url, 'http://localhost');
  const query = {};
  for (const [k, v] of u.searchParams) query[k] = v;
  return { url: u, pathname: u.pathname, query };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function mimeFor(p) {
  return MIME[(p.match(/\.[^.]+$/) || [''])[0].toLowerCase()] || 'application/octet-stream';
}

module.exports = { sendJson, parseUrl, mimeFor };
