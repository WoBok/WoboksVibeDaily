'use strict';

const manifest = require('../services/manifestService');
const { sendJson } = require('../utils/http');

/** 处理 /api/tree、/api/latest、/api/folder */
async function handle(req, res, parsed) {
  const p = parsed.pathname;

  if (p === '/api/tree') {
    sendJson(res, 200, await manifest.getTree());
    return true;
  }

  if (p === '/api/latest') {
    const limit = parseInt(parsed.query.limit, 10) || 0;
    sendJson(res, 200, await manifest.getLatest(limit));
    return true;
  }

  if (p === '/api/folder') {
    const raw = parsed.query.path;
    if (!raw) {
      sendJson(res, 400, { error: 'MISSING_PATH' });
      return true;
    }
    const data = await manifest.getFolder(raw);
    if (data.error === 'NOT_FOUND') {
      sendJson(res, 404, data);
    } else if (data.error) {
      sendJson(res, 400, data);
    } else {
      sendJson(res, 200, data);
    }
    return true;
  }

  return false;
}

module.exports = { handle };
