const { scanContent } = require('./contentScanner');

class ManifestService {
  constructor() {
    this.cache = null;
    this.rebuildPromise = null;
  }

  async init(options = {}) {
    return this.rebuild(options);
  }

  async rebuild(options = {}) {
    if (this.rebuildPromise) return this.rebuildPromise;

    this.rebuildPromise = scanContent(options)
      .then(result => {
        this.cache = result;
        return result;
      })
      .finally(() => {
        this.rebuildPromise = null;
      });

    return this.rebuildPromise;
  }

  getCache() {
    if (!this.cache) {
      throw new Error('MANIFEST_NOT_READY');
    }
    return this.cache;
  }

  getRootManifest() {
    return this.getCache().rootManifest;
  }

  getWatchDirs() {
    return this.getCache().watchDirs || [];
  }

  findFolder(relativePath) {
    const target = String(relativePath || '').replace(/\\/g, '/');
    const walk = nodes => {
      for (const node of nodes) {
        if (node.path === target) return node;
        const child = walk(node.children || []);
        if (child) return child;
      }
      return null;
    };

    return walk(this.getRootManifest().tree);
  }

  findArticle(relativePath) {
    const target = String(relativePath || '').replace(/\\/g, '/');
    return this.getRootManifest().latest.find(article => article.path === target) || null;
  }
}

module.exports = { ManifestService };
