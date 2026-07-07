'use strict';

const crypto = require('crypto');

function sha1(str) {
  return crypto.createHash('sha1').update(str, 'utf8').digest('hex');
}

/**
 * 单篇文章的签名。
 * 规则：sha1(relativePath | size | mtimeMs | fileType)
 * 只要文件名、大小、修改时间或类型任一变化，签名就会变化。
 */
function articleSignature({ relativePath, size, mtimeMs, fileType }) {
  return sha1([relativePath, size, mtimeMs, fileType].join('|'));
}

/**
 * 目录签名：将目录下所有文章签名排序后拼接再 sha1。
 * 任一文章变化都会改变目录签名，用于判断 manifest 是否需要重建。
 */
function folderSignature(articles) {
  const sigs = (articles || [])
    .map((a) => a.signature)
    .filter(Boolean)
    .sort()
    .join('|');
  return 'sha1:' + sha1(sigs);
}

module.exports = { sha1, articleSignature, folderSignature };
