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
    this.metaCache = new Map();
    this.rebuildPromise = null;
    this.rebuildQueued = false;
  }

  async init() {
    return this.rebuild();
  }

  async rebuild() {
    if (this.rebuildPromise) {
      // 重建进行中：排队恰好一次后续重建，避免扫描期间的变更被吞。
      this.rebuildQueued = true;
      return this.rebuildPromise;
    }

    this.rebuildPromise = scanContent(this.metaCache)
      .then(result => {
        if (this.cache && this.cache.marker.signature === result.marker.signature) {
          result.marker.generatedAt = this.cache.marker.generatedAt;
        }
        this.metaCache = result.metaCache;
        this.cache = result;
        return result;
      })
      .finally(() => {
        this.rebuildPromise = null;
        if (this.rebuildQueued) {
          this.rebuildQueued = false;
          this.rebuild().catch(error => console.error('[manifest] queued rebuild failed:', error));
        }
      });

    return this.rebuildPromise;
  }

  getIndex() {
    if (!this.cache) {
      throw new Error('MANIFEST_NOT_READY');
    }
    return this.cache;
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

    return walk(this.getIndex().tree);
  }

  findArticle(relativePath) {
    const target = String(relativePath || '').replace(/\\/g, '/');
    return this.getIndex().latest.find(article => article.path === target) || null;
  }

  getTimelineMonths() {
    const counts = new Map();

    for (const article of this.getIndex().latest) {
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
      articles: this.getIndex().latest.filter(article => articleMonthKey(article) === key)
    };
  }
}

module.exports = { ManifestService };
