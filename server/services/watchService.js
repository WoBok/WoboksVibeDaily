const fs = require('node:fs');
const path = require('node:path');

function createWatchService(manifestService) {
  const watchers = new Map();
  let timer = null;
  let running = false;

  function closeAll() {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  }

  function shouldIgnore(fileName) {
    if (!fileName) return false;
    const name = path.basename(String(fileName));
    return name === '_manifest.json' || name.startsWith('.');
  }

  async function refreshWatchers() {
    closeAll();
    for (const dir of manifestService.getWatchDirs()) {
      if (watchers.has(dir) || !fs.existsSync(dir)) continue;
      const watcher = fs.watch(dir, { persistent: true }, (_eventType, fileName) => {
        if (shouldIgnore(fileName)) return;
        scheduleRebuild();
      });
      watchers.set(dir, watcher);
    }
  }

  function scheduleRebuild() {
    if (!running) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await manifestService.rebuild({ cleanup: false });
        await refreshWatchers();
        console.log('[watch] manifest rebuilt');
      } catch (error) {
        console.error('[watch] rebuild failed:', error);
      }
    }, 500);
  }

  return {
    async start() {
      running = true;
      await refreshWatchers();
      console.log(`[watch] watching ${watchers.size} content directories`);
    },
    stop() {
      running = false;
      clearTimeout(timer);
      closeAll();
    }
  };
}

module.exports = { createWatchService };
