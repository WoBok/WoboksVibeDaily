const { scanContent } = require('./contentScanner');

function normalizeMonthKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return '';

  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';

  return `${match[1]}-${match[2]}`;
}

function articleMonthKey(article) {
  const match = String(article?.date || '').match(/^(\d{4})-(\d{2})/);
  if (!match) return '';

  return normalizeMonthKey(`${match[1]}-${match[2]}`);
}

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

  getTimelineMonths() {
    const counts = new Map();

    for (const article of this.getRootManifest().latest) {
      const key = articleMonthKey(article);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([key, count]) => {
        const [year, month] = key.split('-').map(Number);
        return { year, month, key, count };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  findArticlesByMonth(month) {
    const key = normalizeMonthKey(month);
    if (!key) return null;

    return {
      month: key,
      articles: this.getRootManifest().latest.filter(article => articleMonthKey(article) === key)
    };
  }
}

module.exports = { ManifestService };
