'use strict';

/**
 * 全局配置。
 * 端口与主机可通过环境变量覆盖，便于本地与远程部署复用同一份代码。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..'); // 项目根目录（config.js 位于 server/）
const POSTS_DIR = path.join(ROOT, 'posts');
const POSTS_REL = 'posts'; // 内容根的相对路径，所有 API path 都以此为前缀

const PORT = Number(process.env.WVD_PORT || process.env.PORT || 17321);
const HOST = process.env.WVD_HOST || '127.0.0.1';

module.exports = {
  ROOT,
  POSTS_DIR,
  POSTS_REL,
  PORT,
  HOST,

  // 文章扩展名（小写匹配）
  ARTICLE_EXT: ['.md', '.markdown', '.html'],

  // manifest 文件名，构建与监听都需忽略
  MANIFEST_NAME: '_manifest.json',
  MANIFEST_VERSION: 1,

  // 分类目录前缀：只有 0x 开头的目录会被扫描
  CATEGORY_PREFIX: '0x',

  // 静态内容 URL 前缀（nginx alias / Node 静态服务都使用它）
  CONTENT_BASE: '/content/posts',

  // 文件监听 debounce（毫秒）
  DEBOUNCE_MS: 500,

  // 文件写入完成后等待稳定的阈值（毫秒）
  AWRITE_STABILITY_MS: 250,
  AWRITE_POLL_MS: 50,
};
