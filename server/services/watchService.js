const fs = require('node:fs');
const path = require('node:path');
const { NOTES_DIR } = require('../config');

function createWatchService(manifestService) {
  let watcher = null;
  let timer = null;

  function shouldIgnore(fileName) {
    if (!fileName) return false;
    return path.basename(String(fileName)).startsWith('.');
  }

  function scheduleRebuild() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await manifestService.rebuild();
        console.log('[watch] manifest rebuilt');
      } catch (error) {
        console.error('[watch] rebuild failed:', error);
      }
    }, 500);
  }

  return {
    start() {
      watcher = fs.watch(NOTES_DIR, { persistent: true, recursive: true }, (_eventType, fileName) => {
        if (shouldIgnore(fileName)) return;
        scheduleRebuild();
      });
      watcher.on('error', error => console.error('[watch] watcher error:', error));
      console.log('[watch] watching notes/ recursively');
    },
    stop() {
      clearTimeout(timer);
      watcher?.close();
      watcher = null;
    }
  };
}

module.exports = { createWatchService };
