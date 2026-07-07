'use strict';

const manifest = require('../services/manifestService');
const { sendJson } = require('../utils/http');

/** 处理 /api/article */
async function handle(req, res, parsed) {
  if (parsed.pathname !== '/api/article') return false;

  const raw = parsed.query.path;
  if (!raw) {
    sendJson(res, 400, { error: 'MISSING_PATH' });
    return true;
  }

  const data = await manifest.getArticle(raw);
  if (!data) {
    sendJson(res, 404, { error: 'NOT_FOUND' });
    return true;
  }
  sendJson(res, 200, data);
  return true;
}

module.exports = { handle };
