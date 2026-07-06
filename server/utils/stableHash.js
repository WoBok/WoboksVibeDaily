const crypto = require('node:crypto');

function stableHash(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex');
}

module.exports = { stableHash };
