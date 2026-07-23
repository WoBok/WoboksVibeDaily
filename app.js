(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    tree: [],
    totalArticles: 0,
    activeFolder: '',
    currentArticle: '',
    sidebarMode: 'index',
    timeline: [],
    activeTimelineMonth: '',
    openFolders: new Set(),
    lastListRoute: { type: 'latest' },
    listCacheByRoute: new Map(),
    listScrollByRoute: new Map(),
    listScrollLockKey: '',
    listScrollSaveFrame: 0,
    articleScrollTrackingPath: '',
    articleScrollSaveTimer: 0,
    route: { type: 'latest' },
    renderId: 0,
    scrollIntentRenderId: 0,
    articleCleanup: null
  };

  const MATHJAX_SRC = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
  const MERMAID_SRC = 'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.esm.min.mjs';
  const TIMELINE_MONTH_STEP = 24;
  // 年份标记占位的月格数：12 个月 + 1 格年标记间距。
  const TIMELINE_YEAR_GAP_SLOTS = 13;
  const LATEST_PAGE_SIZE = 30;
  const LIST_CACHE_LIMIT = 30;
  const ARTICLE_SCROLL_STORAGE_KEY = 'wvd:article-scroll:v1';
  const ARTICLE_SCROLL_LIMIT = 100;
  const ARTICLE_SCROLL_SAVE_DELAY = 120;
  const CARD_ANIMATION_DELAY_CAP = 12;
  let mathJaxPromise = null;
  let mermaidPromise = null;
  let listObserver = null;

  const els = {
    body: document.body,
    tree: $('#tree'),
    content: $('#content'),
    sidebar: $('#sidebar'),
    brandLink: $('#brandLink'),
    backBtn: $('#backBtn'),
    indexBtn: $('#indexBtn'),
    indexTab: $('#indexTab'),
    timelineTab: $('#timelineTab'),
    mobileRailActions: $('#mobileRailActions')
  };

  let timelineIndentFrame = 0;
  let timelineYearMeasure = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function decodeHtmlEntities(value) {
    return String(value ?? '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#96;/g, '`')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/');
  }

  function displayName(name) {
    return String(name || '').replace(/^0x[0-9a-f]+\s*-\s*/i, '').trim() || String(name || '');
  }

  function displayPathSegments(path, options = {}) {
    return normalizePath(path)
      .split('/')
      .filter(Boolean)
      .map((part, index) => {
        if (index === 0 && options.rootLabel && part.toLowerCase() === 'notes') return options.rootLabel;
        return displayName(part);
      });
  }

  function displayPath(path, options = {}) {
    return displayPathSegments(path, options).join(' · ');
  }

  function renderDisplayPath(path, options = {}) {
    const segments = displayPathSegments(path, options);
    return segments
      .map(segment => `<span class="path-segment">${escapeHtml(segment)}</span>`)
      .join('<span class="path-separator" aria-hidden="true">·</span>');
  }

  function pathBasename(path) {
    const parts = normalizePath(path).split('/').filter(Boolean);
    return displayName(parts[parts.length - 1]) || 'Latest';
  }

  function normalizeRelativeSegments(value) {
    const segments = [];
    for (const segment of normalizePath(value).split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (!segments.length) return '';
        segments.pop();
        continue;
      }
      segments.push(segment);
    }
    return segments.join('/');
  }

  function splitResourceUrl(value) {
    const match = String(value || '').match(/^([^?#]*)([?#][\s\S]*)?$/);
    return {
      path: match ? match[1] : String(value || ''),
      suffix: match?.[2] || ''
    };
  }

  function encodeContentAssetUrl(relativePath) {
    const body = normalizePath(relativePath).replace(/^notes\//, '');
    return `/content/notes/${body.split('/').map(encodeURIComponent).join('/')}`;
  }

  function resolveResourceUrl(value, articlePath, options = {}) {
    let raw = String(value || '').trim();
    if (options.stripAngleBrackets) raw = raw.replace(/^<([\s\S]+)>$/, '$1');
    if (!raw) return '';
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(raw)) return raw;
    if (raw.startsWith('/content/notes/')) return raw;

    const parts = splitResourceUrl(raw);
    if (!parts.path) return raw;

    let contentPath = '';
    if (parts.path.startsWith('/notes/')) {
      contentPath = normalizeRelativeSegments(parts.path.slice(1));
    } else if (parts.path.startsWith('notes/')) {
      contentPath = normalizeRelativeSegments(parts.path);
    } else if (parts.path.startsWith('/')) {
      return raw;
    } else {
      const baseDir = normalizePath(articlePath).split('/').slice(0, -1).join('/');
      if (!baseDir) return raw;
      contentPath = normalizeRelativeSegments(`${baseDir}/${parts.path}`);
    }

    if (!contentPath.startsWith('notes/')) return raw;
    return `${encodeContentAssetUrl(contentPath)}${parts.suffix}`;
  }

  function rewriteSrcset(value, articlePath) {
    return String(value || '')
      .split(',')
      .map(item => {
        const trimmed = item.trim();
        if (!trimmed) return '';
        const [url, ...descriptors] = trimmed.split(/\s+/);
        return [resolveResourceUrl(url, articlePath), ...descriptors].join(' ');
      })
      .filter(Boolean)
      .join(', ');
  }

  function htmlFrameViewportHeight() {
    const topbarHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height')) || 0;
    return Math.max(0, window.innerHeight - topbarHeight);
  }

  function rewriteHtmlCss(value, articlePath) {
    return String(value || '')
      .replace(/url\((['"]?)([^'")]+)\1\)/gi, (_match, quote, url) => {
        return `url(${quote}${resolveResourceUrl(url, articlePath)}${quote})`;
      })
      .replace(/(-?\d*\.?\d+)vh\b/g, (_match, amount) => {
        const ratio = Number(amount) / 100;
        return `calc(var(--wvd-vh, 1vh) * ${ratio})`;
      });
  }

  function buildHtmlSrcdoc(html, article) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    const articlePath = article.path;
    doc.documentElement.style.setProperty('--wvd-vh', `${htmlFrameViewportHeight()}px`);

    [
      ['img', 'src'],
      ['script', 'src'],
      ['link', 'href'],
      ['source', 'src'],
      ['video', 'src'],
      ['audio', 'src'],
      ['iframe', 'src'],
      ['embed', 'src'],
      ['object', 'data'],
      ['a', 'href']
    ].forEach(([selector, attribute]) => {
      $$(`${selector}[${attribute}]`, doc).forEach(element => {
        element.setAttribute(attribute, resolveResourceUrl(element.getAttribute(attribute), articlePath));
      });
    });

    $$('img[srcset], source[srcset]', doc).forEach(element => {
      element.setAttribute('srcset', rewriteSrcset(element.getAttribute('srcset'), articlePath));
    });

    $$('[style]', doc).forEach(element => {
      element.setAttribute('style', rewriteHtmlCss(element.getAttribute('style'), articlePath));
    });

    $$('style', doc).forEach(style => {
      style.textContent = rewriteHtmlCss(style.textContent, articlePath);
    });

    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  }

  function apiUrl(path, params = {}) {
    const url = new URL(path, window.location.origin);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
    return url.pathname + url.search;
  }

  async function fetchJson(path, params) {
    const response = await fetch(apiUrl(path, params), { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP_${response.status}`);
      error.data = data;
      throw error;
    }
    return data;
  }

  async function fetchText(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.text();
  }

  function normalizeMonthKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return '';

    const month = Number(match[2]);
    if (month < 1 || month > 12) return '';

    return `${match[1]}-${match[2]}`;
  }

  function monthLabel(monthKey) {
    return String(Number(normalizeMonthKey(monthKey).split('-')[1] || 0));
  }

  function timelineTitle(monthKey) {
    const [year, month] = normalizeMonthKey(monthKey).split('-');
    return `${year} · ${Number(month)}`;
  }

  function safeDecodeHash(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return '';
    }
  }

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { type: 'latest' };

    if (raw.startsWith('folder/')) {
      const path = safeDecodeHash(raw.slice('folder/'.length));
      if (path) return { type: 'folder', path };
    }

    if (raw.startsWith('article/')) {
      const path = safeDecodeHash(raw.slice('article/'.length));
      if (path) return { type: 'article', path };
    }

    if (raw.startsWith('timeline/')) {
      const month = normalizeMonthKey(safeDecodeHash(raw.slice('timeline/'.length)));
      if (month) return { type: 'timeline', month };
    }

    return { type: 'latest' };
  }

  function routeHash(type, path) {
    if (type === 'latest') return '#/';
    return `#/${type}/${encodeURIComponent(path)}`;
  }

  function isListRoute(route) {
    return route?.type === 'latest' || route?.type === 'folder' || route?.type === 'timeline';
  }

  function listRouteKey(route) {
    if (!route || route.type === 'latest') return 'latest';
    if (route.type === 'timeline') return `timeline:${normalizeMonthKey(route.month)}`;
    return `folder:${normalizePath(route.path)}`;
  }

  function listRouteFromFolder(path) {
    return { type: 'folder', path: normalizePath(path) };
  }

  function clearContentViewState() {
    delete els.content.dataset.listKey;
    delete els.content.dataset.listSignature;
  }

  function setRoute(type, path) {
    const next = routeHash(type, path);
    if (location.hash === next) render();
    else location.hash = next;
  }

  function isActiveRender(renderId) {
    return renderId === state.renderId;
  }

  function hasScrollIntent(renderId) {
    return Boolean(renderId) && state.scrollIntentRenderId === renderId;
  }

  function markScrollIntent() {
    state.scrollIntentRenderId = state.renderId;
    scheduleListScrollSave();
  }

  function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function cleanupArticleFrame() {
    if (state.articleCleanup) {
      state.articleCleanup();
      state.articleCleanup = null;
    }
  }

  function revealArticleView(renderId, view) {
    if (!view || !isActiveRender(renderId)) return;

    window.requestAnimationFrame(() => {
      if (!view.isConnected || !isActiveRender(renderId)) return;
      view.classList.remove('article-view--loading', 'article-view--preparing');
      view.classList.add('article-view--ready');
    });
  }

  function revealArticleWhenReady(renderId, view, readyPromise, options = {}) {
    const ready = Promise.resolve(readyPromise).catch(() => {});
    Promise.race([ready, delay(options.timeout ?? 520)]).then(() => {
      revealArticleView(renderId, view);
    });
  }

  function isScrollKey(key) {
    return ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(key);
  }

  function withInstantPageScroll(callback) {
    const root = document.documentElement;
    const scrollRoot = document.scrollingElement || root;
    const previousBehavior = root.style.scrollBehavior;

    root.style.scrollBehavior = 'auto';
    try {
      callback(scrollRoot);
    } finally {
      root.style.scrollBehavior = previousBehavior;
    }
  }

  function scrollPageToTop(renderId) {
    if (hasScrollIntent(renderId)) return;

    withInstantPageScroll(scrollRoot => {
      scrollRoot.scrollLeft = 0;
      scrollRoot.scrollTop = 0;
      document.body.scrollLeft = 0;
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
    });
  }

  function pageScrollPosition() {
    const scrollRoot = document.scrollingElement || document.documentElement;
    return {
      left: scrollRoot.scrollLeft || window.scrollX || 0,
      top: scrollRoot.scrollTop || window.scrollY || 0
    };
  }

  function setCappedMapEntry(map, key, value) {
    map.delete(key);
    map.set(key, value);
    if (map.size > LIST_CACHE_LIMIT) map.delete(map.keys().next().value);
  }

  function readArticleScrollStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ARTICLE_SCROLL_STORAGE_KEY) || '{}');
      return Array.isArray(parsed.positions) ? parsed.positions : [];
    } catch {
      return [];
    }
  }

  function articleScrollTarget(path) {
    const articlePath = normalizePath(path);
    const entry = readArticleScrollStore().find(item => normalizePath(item?.path) === articlePath);
    if (!entry) return null;

    return {
      left: Math.max(0, Number(entry.left) || 0),
      top: Math.max(0, Number(entry.top) || 0)
    };
  }

  function saveArticleScroll(path = state.currentArticle) {
    const articlePath = normalizePath(path);
    if (!articlePath || state.articleScrollTrackingPath !== articlePath) return;

    const position = pageScrollPosition();
    const positions = readArticleScrollStore()
      .filter(item => normalizePath(item?.path) !== articlePath)
      .slice(-(ARTICLE_SCROLL_LIMIT - 1));

    positions.push({
      path: articlePath,
      left: Math.max(0, position.left || 0),
      top: Math.max(0, position.top || 0),
      updatedAt: Date.now()
    });

    try {
      localStorage.setItem(ARTICLE_SCROLL_STORAGE_KEY, JSON.stringify({ positions }));
    } catch {
      // Reading should keep working even when storage is unavailable or full.
    }
  }

  function scheduleArticleScrollSave() {
    if (
      state.route.type !== 'article'
      || state.articleScrollTrackingPath !== normalizePath(state.currentArticle)
    ) return;

    if (state.articleScrollSaveTimer) window.clearTimeout(state.articleScrollSaveTimer);
    state.articleScrollSaveTimer = window.setTimeout(() => {
      state.articleScrollSaveTimer = 0;
      saveArticleScroll();
    }, ARTICLE_SCROLL_SAVE_DELAY);
  }

  function flushArticleScrollSave() {
    if (state.articleScrollSaveTimer) {
      window.clearTimeout(state.articleScrollSaveTimer);
      state.articleScrollSaveTimer = 0;
    }
    saveArticleScroll();
  }

  function restoreArticleScroll(renderId, path) {
    const articlePath = normalizePath(path);
    if (!isActiveRender(renderId) || state.currentArticle !== articlePath) return;

    const target = articleScrollTarget(articlePath);
    if (target && !hasScrollIntent(renderId)) {
      withInstantPageScroll(scrollRoot => {
        scrollRoot.scrollLeft = target.left;
        scrollRoot.scrollTop = target.top;
        document.body.scrollLeft = target.left;
        document.body.scrollTop = target.top;
        window.scrollTo(target.left, target.top);
      });
    }

    state.articleScrollTrackingPath = articlePath;
    if (hasScrollIntent(renderId)) scheduleArticleScrollSave();
  }

  function scheduleArticleScrollRestore(renderId, path, readyPromise) {
    const restore = () => restoreArticleScroll(renderId, path);
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 180);
    window.setTimeout(restore, 650);
    Promise.resolve(readyPromise).then(restore).catch(() => {});
  }

  function saveListScroll(route = state.route) {
    if (!isListRoute(route)) return;
    setCappedMapEntry(state.listScrollByRoute, listRouteKey(route), pageScrollPosition());
  }

  function scheduleListScrollSave() {
    if (!isListRoute(state.route) || state.listScrollSaveFrame) return;

    state.listScrollSaveFrame = window.requestAnimationFrame(() => {
      state.listScrollSaveFrame = 0;
      if (isListRoute(state.route)) saveListScroll(state.route);
    });
  }

  function captureListScrollBeforeArticleNavigation(event) {
    if (!isListRoute(state.route)) return;

    const link = event.target?.closest?.('a.post-card[href]');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    if (!href.startsWith('#/article/')) return;

    const key = listRouteKey(state.route);
    saveListScroll(state.route);
    state.listScrollLockKey = key;
  }

  function listScrollTarget(route) {
    return state.listScrollByRoute.get(listRouteKey(route)) || { left: 0, top: 0 };
  }

  function restoreListScroll(renderId, route, options = {}) {
    if (!isActiveRender(renderId) || !isListRoute(route)) return;
    if (!options.force && hasScrollIntent(renderId)) return;

    const target = listScrollTarget(route);
    withInstantPageScroll(scrollRoot => {
      scrollRoot.scrollLeft = Math.max(0, target.left || 0);
      scrollRoot.scrollTop = Math.max(0, target.top || 0);
      document.body.scrollLeft = Math.max(0, target.left || 0);
      document.body.scrollTop = Math.max(0, target.top || 0);
      window.scrollTo(Math.max(0, target.left || 0), Math.max(0, target.top || 0));
    });
  }

  function scrollPageBy(deltaX, deltaY) {
    withInstantPageScroll(() => {
      window.scrollBy(deltaX, deltaY);
    });
  }

  function topbarScrollOffset() {
    const topbar = $('.topbar');
    const measured = topbar?.getBoundingClientRect().height || 0;
    const declared = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height')) || 0;
    return Math.ceil(Math.max(measured, declared));
  }

  function scrollToPageY(top, options = {}) {
    markScrollIntent();
    window.scrollTo({
      left: window.scrollX,
      top: Math.max(0, Math.round(top)),
      behavior: options.behavior || 'auto'
    });
  }

  function scrollElementBelowTopbar(element, options = {}) {
    if (!element) return;
    const gap = options.gap ?? 14;
    const rect = element.getBoundingClientRect();
    scrollToPageY(window.scrollY + rect.top - topbarScrollOffset() - gap, options);
  }

  function scrollFrameElementBelowTopbar(frame, element, options = {}) {
    if (!frame || !element) return;

    const gap = options.gap ?? 14;
    const frameRect = frame.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const frameWindow = frame.contentWindow;
    const frameScrollY = frameWindow?.scrollY
      || element.ownerDocument?.documentElement?.scrollTop
      || element.ownerDocument?.body?.scrollTop
      || 0;
    const frameTop = window.scrollY + frameRect.top;
    const elementTop = elementRect.top + frameScrollY;

    scrollToPageY(frameTop + elementTop - topbarScrollOffset() - gap, options);
  }

  function hashTarget(root, hash) {
    const raw = String(hash || '').replace(/^#/, '');
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {
      id = raw;
    }

    if (!id) return root.body || root.documentElement;
    return root.getElementById(id)
      || $$('[name]', root).find(element => element.getAttribute('name') === id);
  }

  function articleHashFromHref(href, articleUrl) {
    const raw = String(href || '').trim();
    if (!raw) return null;
    if (raw === '#') return '';
    if (raw.startsWith('#')) return raw.slice(1);

    try {
      const targetUrl = new URL(raw, window.location.origin);
      const currentUrl = new URL(articleUrl, window.location.origin);
      if (
        targetUrl.origin === currentUrl.origin
        && targetUrl.pathname === currentUrl.pathname
        && targetUrl.search === currentUrl.search
        && targetUrl.hash
      ) {
        return targetUrl.hash.slice(1);
      }
    } catch {
      return null;
    }

    return null;
  }

  function isCurrentFolder(path) {
    return state.route.type === 'folder' && normalizePath(state.route.path) === normalizePath(path);
  }

  function parentFolderPath(path) {
    const parts = normalizePath(path).split('/').filter(Boolean);
    return parts.slice(0, -1).join('/');
  }

  function isSameOrDescendantPath(path, root) {
    const normalizedPath = normalizePath(path);
    const normalizedRoot = normalizePath(root);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  }

  function closeFolderBranch(path) {
    const normalizedPath = normalizePath(path);
    for (const folder of Array.from(state.openFolders)) {
      if (isSameOrDescendantPath(folder, normalizedPath)) state.openFolders.delete(folder);
    }

    if (state.activeFolder && isSameOrDescendantPath(state.activeFolder, normalizedPath)) {
      state.activeFolder = '';
    }
  }

  function closeAllFolders() {
    state.openFolders.clear();
    state.activeFolder = '';
  }

  function closeSiblingFolders(path) {
    const normalizedPath = normalizePath(path);
    const parentPath = parentFolderPath(normalizedPath);
    for (const folder of Array.from(state.openFolders)) {
      if (folder !== normalizedPath && parentFolderPath(folder) === parentPath) {
        closeFolderBranch(folder);
      }
    }
  }

  function findTreeNode(path, nodes = state.tree) {
    const normalizedPath = normalizePath(path);
    for (const node of nodes || []) {
      if (normalizePath(node.path) === normalizedPath) return node;
      if (node.children?.length) {
        const match = findTreeNode(normalizedPath, node.children);
        if (match) return match;
      }
    }
    return null;
  }

  function folderHasChildren(path) {
    const node = findTreeNode(path);
    return Boolean(node?.children?.length);
  }

  function expandFolderPath(path) {
    const parts = normalizePath(path).split('/').filter(Boolean);
    let acc = '';
    parts.forEach((part, index) => {
      acc = acc ? `${acc}/${part}` : part;
      if (acc !== 'notes' && (index < parts.length - 1 || folderHasChildren(acc))) {
        closeSiblingFolders(acc);
        state.openFolders.add(acc);
      }
    });
  }

  function setViewMode(mode) {
    els.body.classList.toggle('is-article-mode', mode === 'article');
    els.body.classList.remove('is-index-open', 'is-outline-open', 'is-refs-open');
    els.indexBtn.hidden = mode === 'article';
    els.backBtn.hidden = mode !== 'article';
    els.mobileRailActions.hidden = mode !== 'article';
  }

  async function loadTree() {
    const data = await fetchJson('/api/tree');
    state.tree = data.tree || [];
    state.totalArticles = data.totalArticles || 0;
  }

  async function loadTimeline() {
    const data = await fetchJson('/api/timeline');
    state.timeline = data.months || [];
  }

  function renderSidebarTabs(mode) {
    els.indexTab?.classList.toggle('is-active', mode === 'index');
    els.timelineTab?.classList.toggle('is-active', mode === 'timeline');
    els.indexTab?.setAttribute('aria-pressed', String(mode === 'index'));
    els.timelineTab?.setAttribute('aria-pressed', String(mode === 'timeline'));
  }

  function measureTimelineYearOffset(axisWidth) {
    if (!els.tree) return 0;

    const currentYear = String(new Date().getFullYear());
    if (!timelineYearMeasure || !timelineYearMeasure.isConnected) {
      timelineYearMeasure = document.createElement('span');
      timelineYearMeasure.className = 'timeline-year__text timeline-year__measure';
      timelineYearMeasure.setAttribute('aria-hidden', 'true');
      els.tree.appendChild(timelineYearMeasure);
    }

    timelineYearMeasure.textContent = currentYear;
    const yearWidth = timelineYearMeasure.getBoundingClientRect().width;
    if (!yearWidth) return 0;

    const digitWidth = yearWidth / currentYear.length;
    const centeredYearOffset = (yearWidth - axisWidth) / 2;
    return digitWidth + centeredYearOffset;
  }

  function updateTimelineIndent() {
    if (!els.tree || !els.timelineTab || !els.tree.classList.contains('timeline-nav')) return;

    const navRect = els.tree.getBoundingClientRect();
    const tabRect = els.timelineTab.getBoundingClientRect();
    if (!navRect.width && !tabRect.width) return;

    const navStyle = window.getComputedStyle(els.tree);
    const axisWidth = parseFloat(navStyle.getPropertyValue('--timeline-axis-width')) || 0;
    const yearOffset = measureTimelineYearOffset(axisWidth);
    const indent = Math.max(0, Math.round(tabRect.left - navRect.left + yearOffset));
    els.tree.style.setProperty('--timeline-indent', `${indent}px`);
  }

  function scheduleTimelineIndentUpdate() {
    if (timelineIndentFrame) window.cancelAnimationFrame(timelineIndentFrame);
    timelineIndentFrame = window.requestAnimationFrame(() => {
      timelineIndentFrame = 0;
      updateTimelineIndent();
    });
  }

  function appendTimelineConnector(fragment, gapCount) {
    if (gapCount <= 0) return;

    const connector = document.createElement('span');
    connector.className = 'timeline-connector';
    connector.style.setProperty('--month-gap-count', String(gapCount));
    connector.style.setProperty('--month-gap-height', `${gapCount * TIMELINE_MONTH_STEP}px`);
    connector.setAttribute('aria-hidden', 'true');
    fragment.appendChild(connector);
  }

  function appendTimelineYear(fragment, year) {
    const yearNode = document.createElement('div');
    yearNode.className = 'timeline-year';
    yearNode.setAttribute('aria-hidden', 'true');
    yearNode.innerHTML = `
      <span class="timeline-year__dot">·</span>
      <span class="timeline-year__text">${escapeHtml(year)}</span>
      <span class="timeline-year__dot">·</span>
    `;
    fragment.appendChild(yearNode);
  }

  function renderTimelineNav() {
    els.tree.className = 'timeline-nav';
    els.tree.setAttribute('aria-label', 'Timeline');
    updateTimelineIndent();

    const months = state.timeline
      .map(item => ({
        ...item,
        key: normalizeMonthKey(item.key),
        year: Number(item.year),
        month: Number(item.month),
        count: Number(item.count || 0)
      }))
      .filter(item => item.key && item.year && item.month);

    if (!months.length) {
      els.tree.innerHTML = '<div class="empty empty--small"><p>这里还没有时间线。</p></div>';
      return;
    }

    const monthsByYear = new Map();
    months.forEach(item => {
      if (!monthsByYear.has(item.year)) monthsByYear.set(item.year, []);
      monthsByYear.get(item.year).push(item);
    });
    monthsByYear.forEach(yearMonths => {
      yearMonths.sort((a, b) => b.month - a.month);
    });

    const years = months.map(item => item.year);
    const maxYear = Math.max(...years);
    const minYear = Math.min(...years);
    const fragment = document.createDocumentFragment();

    function appendTimelineMonth(item) {
      const button = document.createElement('button');
      const isActive = state.activeTimelineMonth === item.key || state.route.month === item.key;
      button.className = ['timeline-month', isActive ? 'is-active' : ''].filter(Boolean).join(' ');
      button.type = 'button';
      button.dataset.month = item.key;
      button.setAttribute('aria-label', `${item.year}年${item.month}月，${item.count}篇文章`);
      if (isActive) button.setAttribute('aria-current', 'true');
      button.innerHTML = `<span class="timeline-month__label">${escapeHtml(monthLabel(item.key))}</span>`;
      button.addEventListener('click', () => {
        state.sidebarMode = 'timeline';
        state.activeTimelineMonth = item.key;
        els.body.classList.remove('is-index-open');
        setRoute('timeline', item.key);
      });
      fragment.appendChild(button);
    }

    for (let year = maxYear; year >= minYear; year -= 1) {
      const yearMonths = monthsByYear.get(year) || [];

      if (yearMonths.length) {
        yearMonths.forEach((item, index) => {
          appendTimelineMonth(item);

          const next = yearMonths[index + 1];
          if (next) appendTimelineConnector(fragment, item.month - next.month);
          else appendTimelineConnector(fragment, item.month);
        });
      } else {
        appendTimelineConnector(fragment, TIMELINE_YEAR_GAP_SLOTS);
      }

      appendTimelineYear(fragment, year);

      const nextYearMonths = monthsByYear.get(year - 1) || [];
      if (nextYearMonths.length) {
        appendTimelineConnector(fragment, Math.max(1, TIMELINE_YEAR_GAP_SLOTS - nextYearMonths[0].month));
      }
    }

    els.tree.innerHTML = '';
    els.tree.appendChild(fragment);
    updateTimelineIndent();
  }

  function renderSidebarPanel() {
    const mode = state.sidebarMode;
    state.sidebarMode = mode;
    renderSidebarTabs(mode);

    if (mode === 'timeline') {
      renderTimelineNav();
      scheduleTimelineIndentUpdate();
      return;
    }

    renderTree();
  }

  function revealListView() {
    renderSidebarPanel();
    setViewMode('list');
    if (state.sidebarMode === 'timeline') scheduleTimelineIndentUpdate();
  }

  function renderTree() {
    els.tree.className = 'tree';
    els.tree.setAttribute('aria-label', '文章目录');

    if (!state.tree.length) {
      els.tree.innerHTML = '<div class="empty empty--small"><p>这里还没有文章。</p></div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    state.tree.forEach(node => fragment.appendChild(renderTreeNode(node)));
    els.tree.innerHTML = '';
    els.tree.appendChild(fragment);
  }

  function renderTreeNode(node) {
    const wrap = document.createElement('div');
    const hasChildren = node.children && node.children.length > 0;
    const isOpen = state.openFolders.has(node.path);
    const isActive = node.isLeaf && state.activeFolder === node.path;
    const isSelectedPath = node.isLeaf && state.activeFolder
      && (state.activeFolder === node.path || state.activeFolder.startsWith(`${node.path}/`));
    const isClickableLeaf = node.isLeaf && node.articleCount > 0;

    wrap.className = [
      'tree-node',
      hasChildren ? 'tree-node--branch' : 'tree-node--leaf',
      isOpen ? 'is-open' : '',
      isActive ? 'is-active' : '',
      isSelectedPath ? 'is-selected-path' : '',
      node.isLeaf && node.articleCount === 0 ? 'is-empty' : ''
    ].filter(Boolean).join(' ');

    const row = document.createElement('button');
    row.className = 'tree-node__row';
    row.type = 'button';
    row.setAttribute('aria-expanded', hasChildren ? String(isOpen) : 'false');
    row.innerHTML = `
      <span class="tree-node__dot" aria-hidden="true"></span>
      <span class="tree-node__label">${escapeHtml(node.name)}</span>
      <span class="tree-node__count">${node.articleCount || 0}</span>
    `;

    row.addEventListener('click', () => {
      if (hasChildren) {
        if (isOpen) {
          closeFolderBranch(node.path);
        } else {
          closeSiblingFolders(node.path);
          state.openFolders.add(node.path);
        }
        renderTree();
        return;
      }

      if (!isClickableLeaf) {
        closeSiblingFolders(node.path);
        renderTree();
        return;
      }

      if (isCurrentFolder(node.path)) {
        state.activeFolder = node.path;
        els.body.classList.remove('is-index-open');
        renderTree();
        return;
      }

      closeSiblingFolders(node.path);
      state.activeFolder = node.path;
      els.body.classList.remove('is-index-open');
      setRoute('folder', node.path);
    });

    wrap.appendChild(row);

    if (hasChildren) {
      const children = document.createElement('div');
      children.className = 'tree-node__children';
      const inner = document.createElement('div');
      node.children.forEach(child => inner.appendChild(renderTreeNode(child)));
      children.appendChild(inner);
      wrap.appendChild(children);
    }

    return wrap;
  }

  function listSignature(title, eyebrow, articles, total) {
    return JSON.stringify([
      title,
      eyebrow,
      total || 0,
      (articles || []).map(article => [
        article.path,
        article.title,
        article.date,
        article.categoryName,
        article.summary
      ])
    ]);
  }

  function cacheList(route, entry) {
    if (!isListRoute(route)) return;
    setCappedMapEntry(state.listCacheByRoute, listRouteKey(route), entry);
  }

  function renderCachedList(route, renderId) {
    const cached = state.listCacheByRoute.get(listRouteKey(route));
    if (!cached) return false;

    renderListShell(cached.title, cached.eyebrow, cached.articles, {
      route,
      cache: false,
      steady: true,
      total: cached.total
    });
    restoreListScroll(renderId, route, { force: true });
    return true;
  }

  function disconnectListObserver() {
    listObserver?.disconnect();
    listObserver = null;
  }

  function renderListShell(title, eyebrow, articles, options = {}) {
    cleanupArticleFrame();
    disconnectListObserver();
    const route = options.route || state.route;
    const routeKey = isListRoute(route) ? listRouteKey(route) : '';
    const total = Math.max(Number(options.total) || 0, articles.length);
    const signature = listSignature(title, eyebrow, articles, total);
    const cacheEntry = () => ({ title, eyebrow, articles: articles.slice(), signature, total });
    if (
      options.skipIfUnchanged !== false
      && routeKey
      && els.content.dataset.listKey === routeKey
      && els.content.dataset.listSignature === signature
    ) {
      if (options.cache !== false) cacheList(route, cacheEntry());
      return;
    }

    const summary = total === 1 ? '1 note' : `${total} notes`;
    const viewClass = ['list-view', options.steady ? 'list-view--steady' : ''].filter(Boolean).join(' ');
    els.content.innerHTML = `
      <div class="${viewClass}">
        <header class="list-view__header">
          <div class="list-view__eyebrow">${eyebrow}</div>
          <h1 class="list-view__title">${escapeHtml(title)}</h1>
          <div class="list-view__count">${summary}</div>
        </header>
        <div class="list-view__items">
          ${articles.length ? articles.map(renderArticleCard).join('') : `
            <div class="empty">
              <p>这里还没有文章。</p>
            </div>
          `}
        </div>
        ${total > articles.length ? '<div class="list-sentinel" aria-hidden="true"></div>' : ''}
      </div>
    `;
    if (routeKey) {
      els.content.dataset.listKey = routeKey;
      els.content.dataset.listSignature = signature;
    } else {
      clearContentViewState();
    }

    if (options.cache !== false) cacheList(route, cacheEntry());
  }

  function renderArticleCard(article, index) {
    const delay = Math.min(index, CARD_ANIMATION_DELAY_CAP) * 45;
    return `
      <a class="post-card" href="${routeHash('article', article.path)}" style="animation-delay:${delay}ms">
        <div class="post-card__meta">
          <span>${escapeHtml(article.date || '—')}</span>
          <span class="meta-separator" aria-hidden="true">·</span>
          <span>${escapeHtml(article.categoryName || '')}</span>
        </div>
        <h2 class="post-card__title">${escapeHtml(article.title)}</h2>
        ${article.summary ? `<p class="post-card__summary">${escapeHtml(article.summary)}</p>` : ''}
      </a>
    `;
  }

  function appendLatestCards(articles) {
    const items = $('.list-view__items', els.content);
    if (!items) return;
    const holder = document.createElement('template');
    holder.innerHTML = articles.map((article, index) => renderArticleCard(article, index)).join('');
    items.appendChild(holder.content);
  }

  function watchLatestSentinel(renderId, route, entry) {
    disconnectListObserver();
    const sentinel = $('.list-sentinel', els.content);
    if (!sentinel) return;

    let loading = false;
    listObserver = new IntersectionObserver(async observations => {
      if (loading || !observations.some(observation => observation.isIntersecting)) return;
      loading = true;
      try {
        const data = await fetchJson('/api/latest', { limit: LATEST_PAGE_SIZE, offset: entry.articles.length });
        if (!isActiveRender(renderId) || !sentinel.isConnected) return;

        const more = data.articles || [];
        appendLatestCards(more);
        entry.articles.push(...more);
        entry.total = Math.max(Number(data.totalArticles) || 0, entry.articles.length);
        entry.signature = listSignature(entry.title, entry.eyebrow, entry.articles, entry.total);
        els.content.dataset.listSignature = entry.signature;
        cacheList(route, entry);

        if (!more.length || entry.articles.length >= entry.total) {
          disconnectListObserver();
          sentinel.remove();
        }
      } catch (error) {
        console.warn('[latest] load more failed:', error);
      } finally {
        loading = false;
      }
    }, { rootMargin: '600px 0px' });

    listObserver.observe(sentinel);
  }

  async function renderLatest(renderId, options = {}) {
    state.activeFolder = '';
    state.currentArticle = '';
    state.activeTimelineMonth = '';
    const route = { type: 'latest' };
    state.lastListRoute = route;
    revealListView();
    const cached = options.restoreScroll ? state.listCacheByRoute.get(listRouteKey(route)) : null;
    if (cached) renderCachedList(route, renderId);

    // 返回列表时按已加载数量重取，保证滚动位置对应的卡片全部就位。
    const limit = Math.max(LATEST_PAGE_SIZE, cached?.articles.length || 0);
    const data = await fetchJson('/api/latest', { limit });
    if (!isActiveRender(renderId)) return false;
    const articles = data.articles || [];
    const total = Math.max(Number(data.totalArticles) || 0, articles.length);
    renderListShell('Latest', escapeHtml('HOME'), articles, {
      route,
      steady: options.restoreScroll,
      total
    });
    watchLatestSentinel(renderId, route, {
      title: 'Latest',
      eyebrow: escapeHtml('HOME'),
      articles,
      total,
      signature: listSignature('Latest', escapeHtml('HOME'), articles, total)
    });
    if (options.restoreScroll) restoreListScroll(renderId, route);
    else scrollPageToTop(renderId);
    return true;
  }

  async function renderFolder(path, renderId, options = {}) {
    const folderPath = normalizePath(path);
    state.activeFolder = folderPath;
    state.currentArticle = '';
    state.activeTimelineMonth = '';
    state.sidebarMode = 'index';
    const route = listRouteFromFolder(folderPath);
    state.lastListRoute = route;
    expandFolderPath(folderPath);
    revealListView();
    if (options.restoreScroll) renderCachedList(route, renderId);

    const data = await fetchJson('/api/folder', { path: folderPath });
    if (!isActiveRender(renderId)) return false;
    renderListShell(pathBasename(folderPath), renderDisplayPath(folderPath), data.articles || [], {
      route,
      steady: options.restoreScroll
    });
    if (options.restoreScroll) restoreListScroll(renderId, route);
    else scrollPageToTop(renderId);
    return true;
  }

  async function renderTimelineMonth(month, renderId, options = {}) {
    const monthKey = normalizeMonthKey(month);
    if (!monthKey) return false;

    state.activeFolder = '';
    state.currentArticle = '';
    state.activeTimelineMonth = monthKey;
    state.sidebarMode = 'timeline';
    const route = { type: 'timeline', month: monthKey };
    state.lastListRoute = route;
    revealListView();
    if (options.restoreScroll) renderCachedList(route, renderId);

    const data = await fetchJson('/api/timeline/month', { month: monthKey });
    if (!isActiveRender(renderId)) return false;
    renderListShell(timelineTitle(monthKey), escapeHtml('TIMELINE'), data.articles || [], {
      route,
      steady: options.restoreScroll
    });
    if (options.restoreScroll) restoreListScroll(renderId, route);
    else scrollPageToTop(renderId);
    return true;
  }

  function parseFrontmatter(markdown) {
    const source = String(markdown || '')
      .replace(/^\uFEFF/, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/?font\b[^>]*>/gi, '')
      .replace(/<\/?span\b[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n');
    const match = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return {
      body: match ? source.slice(match[0].length) : source
    };
  }

  function slugify(text, fallback) {
    const slug = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
    return slug || fallback;
  }

  function safeLinkHref(href) {
    const value = String(href || '');
    if (/^(?:https?:|mailto:|tel:)/i.test(value)) return value;
    // 其余带协议的地址（javascript: 等）一律不生成链接。
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) return '';
    return value;
  }

  function renderInlineMarkdown(value, context = {}) {
    const snippets = [];
    const stash = snippet => {
      snippets.push(snippet);
      return `@@INLINE_${snippets.length - 1}@@`;
    };

    // `\$` 表示字面美元符；包一层 span 避免被 MathJax 与其他 `$` 配对。
    let html = String(value || '').replace(/\\\$/g, () => stash('<span>$</span>'));

    // 先处理 `$$...$$`，避免后续的单 `$` 匹配拆坏双美元公式。
    // 行内上下文（例如表格单元格）统一交给 MathJax 按行内公式排版。
    html = html.replace(/\$\$([^$\n]+?)\$\$/g, (_match, body) =>
      stash(`<span class="math-inline">$${escapeHtml(body)}$</span>`));

    html = html.replace(/\$([^$\n]+?)\$/g, (_match, body) =>
      stash(`<span class="math-inline">$${escapeHtml(body)}$</span>`));

    html = escapeHtml(html);

    html = html.replace(/`([^`]+)`/g, (_match, body) => stash(`<code>${body}</code>`));

    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
      const resolvedSrc = resolveResourceUrl(decodeHtmlEntities(src), context.articlePath, { stripAngleBrackets: true });
      return `<img src="${escapeAttr(resolvedSrc)}" alt="${escapeAttr(decodeHtmlEntities(alt))}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
    });

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const resolvedHref = safeLinkHref(resolveResourceUrl(decodeHtmlEntities(href), context.articlePath, { stripAngleBrackets: true }));
      return resolvedHref ? `<a href="${escapeAttr(resolvedHref)}">${label}</a>` : label;
    });

    html = html
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 回调形式回填，避免片段中的 $& $' 等被 replace 当作特殊替换模式。
    return html.replace(/@@INLINE_(\d+)@@/g, (_match, index) => snippets[Number(index)]);
  }

  function findClosingDollar(value, fromIndex) {
    const text = String(value || '');
    for (let index = fromIndex; index < text.length; index += 1) {
      if (text[index] === '$' && text[index - 1] !== '\\') return index;
    }
    return -1;
  }

  function isEquationLabel(value) {
    const text = String(value || '').trim();
    return !text || /^[（(]\s*[\w\d一二三四五六七八九十IVXLCDMivxlcdm.-]+\s*[）)]$/.test(text);
  }

  function readDisplayMath(lines, startIndex) {
    const firstLine = lines[startIndex] || '';
    const firstTrimmed = firstLine.trimStart();
    if (!firstTrimmed.startsWith('$')) return null;

    const delimiter = firstTrimmed.startsWith('$$') ? '$$' : '$';
    const delimiterLength = delimiter.length;
    const contentStart = firstLine.length - firstTrimmed.length + delimiterLength;
    const firstClosing = delimiter === '$$'
      ? firstLine.indexOf('$$', contentStart)
      : findClosingDollar(firstLine, contentStart);

    if (firstClosing !== -1) {
      const suffix = firstLine.slice(firstClosing + delimiterLength).trim();
      if (delimiter === '$' && !isEquationLabel(suffix)) return null;

      return {
        math: firstLine.slice(contentStart, firstClosing).trim(),
        suffix,
        nextIndex: startIndex
      };
    }

    const mathLines = [firstLine.slice(contentStart)];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      const closing = delimiter === '$$'
        ? line.indexOf('$$')
        : findClosingDollar(line, 0);

      if (closing !== -1) {
        mathLines.push(line.slice(0, closing));
        return {
          math: mathLines.join('\n').trim(),
          suffix: line.slice(closing + delimiterLength).trim(),
          nextIndex: index
        };
      }

      mathLines.push(line);
    }

    return null;
  }

  function renderMathBlock(source, suffix = '', context = {}) {
    const trimmed = String(source || '').trim();
    let math = trimmed;

    if (trimmed.startsWith('$$') || (trimmed.startsWith('\\[') && trimmed.endsWith('\\]'))) {
      math = trimmed;
    } else if (trimmed.startsWith('$') && trimmed.endsWith('$')) {
      math = `$$\n${trimmed.slice(1, -1).trim()}\n$$`;
    } else {
      math = `$$\n${trimmed}\n$$`;
    }

    const suffixHtml = suffix ? `<span class="math-block__suffix">${renderInlineMarkdown(suffix, context)}</span>` : '';
    return `<div class="math-block">${escapeHtml(math)}${suffixHtml}</div>`;
  }

  const CJK_CHAR = /[⺀-鿿豈-﫿︰-﹏＀-￯]/;

  function joinParagraphLines(lines) {
    return lines.reduce((joined, line) => {
      if (!joined) return line;
      // 中文（CJK）跨行书写时直接拼接，避免换行处插入英文空格。
      const noSpace = CJK_CHAR.test(joined[joined.length - 1]) && CJK_CHAR.test(line[0]);
      return noSpace ? joined + line : `${joined} ${line}`;
    }, '');
  }

  function matchListItem(line) {
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (!match) return null;

    const type = /^\d+\.$/.test(match[2]) ? 'ol' : 'ul';
    let content = match[3];
    let task = '';

    if (type === 'ul') {
      const taskMatch = content.match(/^\[([ xX])\]\s+(.+)$/);
      if (taskMatch) {
        task = taskMatch[1] === ' ' ? 'unchecked' : 'checked';
        content = taskMatch[2];
      }
    }

    const start = type === 'ol' ? Number.parseInt(match[2], 10) : 1;
    return { indent: match[1].replace(/\t/g, '  ').length, type, content, task, start };
  }

  function renderListLevel(items, start, indent, context) {
    const type = items[start].type;
    const parts = [];
    let index = start;

    while (index < items.length && items[index].indent === indent && items[index].type === type) {
      const item = items[index];
      let inner = renderInlineMarkdown(item.content, context);
      if (item.task) {
        inner = `<input type="checkbox" disabled${item.task === 'checked' ? ' checked' : ''}> ${inner}`;
      }
      index += 1;

      while (index < items.length && items[index].indent > indent) {
        const child = renderListLevel(items, index, items[index].indent, context);
        inner += child.html;
        index = child.next;
      }

      parts.push(`<li${item.task ? ' class="task-item"' : ''}>${inner}</li>`);
    }

    const startAttr = type === 'ol' && items[start].start !== 1 ? ` start="${items[start].start}"` : '';
    return { html: `<${type}${startAttr}>${parts.join('')}</${type}>`, next: index };
  }

  function renderListBlock(items, context) {
    const html = [];
    let index = 0;
    while (index < items.length) {
      const level = renderListLevel(items, index, items[index].indent, context);
      html.push(level.html);
      index = level.next;
    }
    return html.join('');
  }

  function splitTableRow(line) {
    return String(line || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map(cell => cell.trim().replace(/\\\|/g, '|'));
  }

  function isTableSeparator(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed.includes('-') || !/^[|\s:-]+$/.test(trimmed)) return false;
    return splitTableRow(trimmed).every(cell => /^:?-+:?$/.test(cell));
  }

  function renderTable(headerLine, separatorLine, rowLines, context) {
    const headers = splitTableRow(headerLine);
    const aligns = splitTableRow(separatorLine).map(cell => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
      if (cell.endsWith(':')) return 'right';
      if (cell.startsWith(':')) return 'left';
      return '';
    });
    const alignAttr = index => (aligns[index] ? ` style="text-align:${aligns[index]}"` : '');

    const head = headers
      .map((cell, index) => `<th${alignAttr(index)}>${renderInlineMarkdown(cell, context)}</th>`)
      .join('');
    const body = rowLines
      .map(rowLine => {
        const cells = splitTableRow(rowLine);
        return `<tr>${headers
          .map((_cell, index) => `<td${alignAttr(index)}>${renderInlineMarkdown(cells[index] ?? '', context)}</td>`)
          .join('')}</tr>`;
      })
      .join('');

    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table></div>`;
  }

  function renderMarkdown(markdown, context = {}) {
    const { body } = parseFrontmatter(markdown);
    const lines = body.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${renderInlineMarkdown(joinParagraphLines(paragraph), context)}</p>`);
      paragraph = [];
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        continue;
      }

      const displayMath = readDisplayMath(lines, i);
      if (displayMath) {
        flushParagraph();
        html.push(renderMathBlock(displayMath.math, displayMath.suffix, context));
        i = displayMath.nextIndex;
        continue;
      }

      const fence = trimmed.match(/^```(\w*)/);
      if (fence) {
        flushParagraph();
        const lang = fence[1] || '';
        const code = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          code.push(lines[i]);
          i += 1;
        }
        html.push(`<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInlineMarkdown(heading[2], context)}</h${level}>`);
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        flushParagraph();
        html.push('<hr>');
        continue;
      }

      const listItem = matchListItem(line);
      if (listItem) {
        flushParagraph();
        const items = [listItem];
        while (i + 1 < lines.length) {
          const next = matchListItem(lines[i + 1]);
          if (!next) break;
          items.push(next);
          i += 1;
        }
        html.push(renderListBlock(items, context));
        continue;
      }

      if (trimmed.startsWith('>')) {
        flushParagraph();
        const quoted = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoted.push(lines[i].trim().replace(/^>\s?/, ''));
          i += 1;
        }
        i -= 1;

        const paragraphs = [];
        let buffer = [];
        for (const quoteLine of quoted) {
          if (!quoteLine.trim()) {
            if (buffer.length) paragraphs.push(buffer);
            buffer = [];
            continue;
          }
          buffer.push(quoteLine);
        }
        if (buffer.length) paragraphs.push(buffer);

        html.push(`<blockquote>${paragraphs
          .map(part => `<p>${part
            .map(quoteLine => renderInlineMarkdown(quoteLine.trimEnd(), context))
            .join('<br>')}</p>`)
          .join('')}</blockquote>`);
        continue;
      }

      if (trimmed.includes('|') && isTableSeparator(lines[i + 1])) {
        flushParagraph();
        const headerLine = trimmed;
        const separatorLine = lines[i + 1];
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim().includes('|')) {
          rows.push(lines[i]);
          i += 1;
        }
        i -= 1;
        html.push(renderTable(headerLine, separatorLine, rows, context));
        continue;
      }

      paragraph.push(trimmed);
    }

    flushParagraph();
    return html.join('\n');
  }

  function containsMath(root) {
    const text = root?.textContent || '';
    return /(?:\$\$|\$[^$\n]+?\$|\\\(|\\\[|\\begin\{)/.test(text);
  }

  function ensureMathJax() {
    if (window.MathJax?.typesetPromise) return Promise.resolve(window.MathJax);

    if (!mathJaxPromise) {
      window.MathJax = {
        ...(window.MathJax || {}),
        tex: {
          inlineMath: [['$', '$'], ['\\(', '\\)']],
          displayMath: [['$$', '$$'], ['\\[', '\\]']],
          processEscapes: true,
          processEnvironments: true,
          ...(window.MathJax?.tex || {})
        },
        options: {
          skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
          ...(window.MathJax?.options || {})
        },
        svg: {
          fontCache: 'global',
          ...(window.MathJax?.svg || {})
        },
        startup: {
          typeset: false,
          ...(window.MathJax?.startup || {})
        }
      };

      mathJaxPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-mathjax]');

        const resolveWhenReady = () => {
          const ready = window.MathJax?.startup?.promise || Promise.resolve();
          ready.then(() => resolve(window.MathJax), reject);
        };

        if (existing) {
          existing.addEventListener('load', resolveWhenReady, { once: true });
          existing.addEventListener('error', reject, { once: true });
          return;
        }

        const script = document.createElement('script');
        script.src = MATHJAX_SRC;
        script.async = true;
        script.dataset.mathjax = 'true';
        script.addEventListener('load', resolveWhenReady, { once: true });
        script.addEventListener('error', reject, { once: true });
        document.head.appendChild(script);
      });
    }

    return mathJaxPromise;
  }

  async function typesetMath(root) {
    if (!containsMath(root)) return;

    try {
      const mathJax = await ensureMathJax();
      mathJax.typesetClear?.([root]);
      await mathJax.typesetPromise([root]);
    } catch (error) {
      console.warn('[math] MathJax failed:', error);
    }
  }

  function findMermaidBlocks(root) {
    return $$('pre > code.language-mermaid', root);
  }

  function ensureMermaid() {
    if (!mermaidPromise) {
      mermaidPromise = import(MERMAID_SRC).then(module => {
        const mermaid = module.default;
        const styles = getComputedStyle(document.documentElement);
        const color = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
        const ivory = color('--ivory', '#F9F8F4');
        const ivoryWarm = color('--ivory-warm', '#F3EFE6');
        const paper = color('--paper', '#FCFAF4');
        const forest = color('--forest', '#2D3A31');
        const moss = color('--moss', '#4F5E4A');
        const sage = color('--sage', '#8C9A84');
        const sageLight = color('--sage-light', '#C8D1BF');
        const sageActive = color('--sage-active', '#DDE9D2');
        const clay = color('--clay', '#C27B66');
        const clayDeep = color('--clay-deep', '#A65D4B');
        const ink = color('--ink', '#1F2620');
        const inkSoft = color('--ink-soft', '#4A534B');

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: 'base',
          fontFamily: '"Newsreader", "Source Han Serif SC", "Songti SC", Georgia, serif',
          themeVariables: {
            background: ivory,
            primaryColor: ivoryWarm,
            primaryTextColor: ink,
            primaryBorderColor: moss,
            secondaryColor: sageActive,
            secondaryTextColor: forest,
            secondaryBorderColor: sage,
            tertiaryColor: paper,
            tertiaryTextColor: inkSoft,
            tertiaryBorderColor: sageLight,
            lineColor: moss,
            textColor: ink,
            mainBkg: ivoryWarm,
            nodeBorder: moss,
            clusterBkg: paper,
            clusterBorder: sageLight,
            titleColor: forest,
            edgeLabelBackground: ivory,
            actorBkg: ivoryWarm,
            actorBorder: moss,
            actorTextColor: ink,
            actorLineColor: sage,
            signalColor: forest,
            signalTextColor: ink,
            labelBoxBkgColor: paper,
            labelBoxBorderColor: sage,
            labelTextColor: ink,
            loopTextColor: inkSoft,
            noteBkgColor: sageActive,
            noteBorderColor: sage,
            noteTextColor: ink,
            activationBkgColor: sageLight,
            activationBorderColor: moss,
            sectionBkgColor: ivoryWarm,
            altSectionBkgColor: paper,
            gridColor: sageLight,
            todayLineColor: clay,
            taskBkgColor: sageActive,
            taskBorderColor: moss,
            taskTextColor: ink,
            taskTextOutsideColor: inkSoft,
            critBkgColor: clay,
            critBorderColor: clayDeep,
            doneTaskBkgColor: sageLight,
            doneTaskBorderColor: sage,
            activeTaskBkgColor: ivoryWarm,
            activeTaskBorderColor: moss
          }
        });
        return mermaid;
      });
    }

    return mermaidPromise;
  }

  async function typesetMermaid(root) {
    const blocks = findMermaidBlocks(root);
    if (!blocks.length) return;

    try {
      const mermaid = await ensureMermaid();

      for (const code of blocks) {
        const sourceBlock = code.parentElement;
        if (!sourceBlock?.isConnected || !root.contains(sourceBlock)) continue;

        const figure = document.createElement('figure');
        figure.className = 'mermaid-diagram';
        const diagram = document.createElement('div');
        diagram.className = 'mermaid';
        diagram.textContent = code.textContent || '';
        figure.appendChild(diagram);
        sourceBlock.replaceWith(figure);

        try {
          await mermaid.run({ nodes: [diagram] });
        } catch (error) {
          figure.replaceWith(sourceBlock);
          console.warn('[mermaid] Diagram rendering failed:', error);
        }
      }
    } catch (error) {
      console.warn('[mermaid] Mermaid failed to load:', error);
    }
  }

  function enableMarkdownHorizontalWheel(root) {
    root?.addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return;

      const target = event.target.closest(
        'pre code, .math-block mjx-container[jax="SVG"][display="true"]'
      );
      if (!target || !root.contains(target) || target.scrollWidth <= target.clientWidth) return;

      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * target.clientHeight
          : event.deltaY;
      const nextScrollLeft = Math.max(0, Math.min(target.scrollLeft + delta, target.scrollWidth - target.clientWidth));

      event.preventDefault();
      target.scrollLeft = nextScrollLeft;
    }, { passive: false });
  }

  function isExternalLink(link, baseUrl) {
    const raw = link.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return false;
    try {
      const url = new URL(raw, baseUrl);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function linkLabel(link) {
    const text = link.textContent.replace(/\s+/g, ' ').trim();
    if (text) return text;
    try {
      return new URL(link.href).hostname;
    } catch {
      return link.getAttribute('href') || '';
    }
  }

  function prepareHeadings(root) {
    return $$('h1, h2, h3, h4, h5, h6', root).map((heading, index) => {
      if (!heading.id) heading.id = `heading-${index + 1}-${slugify(heading.textContent, 'section')}`;
      return {
        id: heading.id,
        text: heading.textContent.replace(/\s+/g, ' ').trim(),
        level: Number(heading.tagName.slice(1)),
        element: heading
      };
    }).filter(item => item.text);
  }

  function prepareMarkdownImages(root) {
    $$('img', root).forEach(image => {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', image.alt ? `Open image: ${image.alt}` : 'Open image');

      const openImage = () => openImageLightbox(image);
      image.addEventListener('click', openImage);
      image.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openImage();
      });

      const setLoaded = () => {
        image.classList.remove('is-error');
        image.classList.add('is-loaded');
      };
      const setError = () => {
        image.classList.remove('is-loaded');
        image.classList.add('is-error');
        image.title = image.alt || 'Image failed to load';
      };

      if (image.complete) {
        if (image.naturalWidth > 0) setLoaded();
        else setError();
        return;
      }

      image.addEventListener('load', setLoaded, { once: true });
      image.addEventListener('error', setError, { once: true });
    });
  }

  function openImageLightbox(sourceImage) {
    if (!sourceImage?.src || sourceImage.classList.contains('is-error')) return;

    const previousOverflow = document.body.style.overflow;
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const closeButton = document.createElement('button');
    closeButton.className = 'image-lightbox__close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close image');
    closeButton.textContent = '×';

    const figure = document.createElement('figure');
    figure.className = 'image-lightbox__figure';

    const image = document.createElement('img');
    image.className = 'image-lightbox__image';
    image.src = sourceImage.currentSrc || sourceImage.src;
    image.alt = sourceImage.alt || '';
    image.decoding = 'async';

    figure.appendChild(image);

    if (sourceImage.alt) {
      const caption = document.createElement('figcaption');
      caption.className = 'image-lightbox__caption';
      caption.textContent = sourceImage.alt;
      figure.appendChild(caption);
    }

    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = previousOverflow;
      overlay.remove();
    };

    function onKeydown(event) {
      if (event.key === 'Escape') close();
    }

    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);

    overlay.append(closeButton, figure);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    closeButton.focus({ preventScroll: true });
  }

  function prepareReferences(root, baseUrl, mode) {
    const refs = [];
    $$('a[href]', root).forEach(link => {
      if (link.querySelector('img')) return;
      if (!isExternalLink(link, baseUrl)) return;
      const index = refs.length + 1;
      const text = linkLabel(link);
      link.dataset.wvdRef = String(index);

      if (mode === 'markdown') {
        const sup = document.createElement('sup');
        sup.className = 'ref-mark';
        sup.textContent = String(index);
        link.appendChild(sup);
      }

      refs.push({
        index,
        text,
        href: new URL(link.getAttribute('href'), baseUrl).href,
        element: link
      });
    });
    return refs;
  }

  function injectHtmlReferenceStyle(doc) {
    if (doc.getElementById('wvd-ref-style')) return;
    const style = doc.createElement('style');
    style.id = 'wvd-ref-style';
    style.textContent = `
      a[data-wvd-ref] {
        position: relative;
        text-decoration-line: underline;
        text-underline-offset: 0.16em;
      }

      a[data-wvd-ref]::before {
        content: attr(data-wvd-ref);
        position: absolute;
        left: -0.65em;
        top: -0.75em;
        font-size: 0.62em;
        line-height: 1;
      }
    `;
    doc.head.appendChild(style);
  }

  function parseRenderedRgb(value) {
    const match = String(value || '').match(/^rgba?\(\s*([\d.]+)[,\s]+\s*([\d.]+)[,\s]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
    if (!match) return null;
    return {
      red: Number(match[1]),
      green: Number(match[2]),
      blue: Number(match[3]),
      alpha: match[4] === undefined ? 1 : Number(match[4])
    };
  }

  function relativeLuminance({ red, green, blue }) {
    const linear = [red, green, blue].map(channel => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  function htmlArticleSurfaceTone(doc) {
    const layers = [doc.documentElement, doc.body]
      .filter(Boolean)
      .map(element => parseRenderedRgb(doc.defaultView?.getComputedStyle(element).backgroundColor));
    let surface = { red: 249, green: 248, blue: 244 };

    layers.forEach(layer => {
      if (!layer || layer.alpha <= 0) return;
      const alpha = Math.min(1, Math.max(0, layer.alpha));
      surface = {
        red: layer.red * alpha + surface.red * (1 - alpha),
        green: layer.green * alpha + surface.green * (1 - alpha),
        blue: layer.blue * alpha + surface.blue * (1 - alpha)
      };
    });

    return relativeLuminance(surface) < 0.42 ? 'dark' : 'light';
  }

  function bridgeHtmlFixedElements(frame, doc, signal) {
    const records = new Map();
    let animationFrame = 0;

    const prepare = () => {
      $$('*', doc).forEach(element => {
        if (records.has(element) || doc.defaultView?.getComputedStyle(element).position !== 'fixed') return;
        const rect = element.getBoundingClientRect();
        records.set(element, { viewportTop: rect.top });
        element.dataset.wvdFixedBridge = '';
        element.style.setProperty('position', 'absolute', 'important');
        element.style.setProperty('bottom', 'auto', 'important');
      });
    };

    const sync = () => {
      animationFrame = 0;
      records.forEach((record, element) => {
        if (!element.isConnected) {
          records.delete(element);
          return;
        }
        element.style.setProperty('top', `${Math.round(window.scrollY + record.viewportTop)}px`, 'important');
      });
    };

    const scheduleSync = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(sync);
    };

    const observer = new MutationObserver(mutations => {
      const needsSync = mutations.some(mutation => {
        return mutation.type === 'childList' || mutation.target.dataset.wvdFixedBridge === undefined;
      });
      if (!needsSync) return;
      prepare();
      scheduleSync();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

    prepare();
    sync();
    window.addEventListener('scroll', scheduleSync, { passive: true, signal });
    window.addEventListener('resize', scheduleSync, { passive: true, signal });
    signal.addEventListener('abort', () => {
      observer.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    }, { once: true });
  }

  function railTemplate(type, items, options = {}) {
    const emptyText = type === 'outline' ? 'No headings' : 'No refs';
    const surfaceClass = options.surfaceTone === 'dark' ? ' article-rail--on-dark' : '';
    return `
      <aside class="article-rail article-rail--${type}${surfaceClass}" id="${type}Rail">
        <div class="article-rail__inner">
          ${items.length ? items.map((item, index) => `
            <button class="rail-item rail-item--level-${item.level || 1}" type="button" data-index="${index}">
              <span class="rail-item__line" aria-hidden="true"></span>
              <span class="rail-item__text">${escapeHtml(type === 'refs' && item.index ? `${item.index}. ${item.text}` : item.text)}</span>
            </button>
          `).join('') : `<div class="rail-empty">${emptyText}</div>`}
        </div>
      </aside>
    `;
  }

  function bindRailCollapse(rail) {
    if (!rail) return;
    let fadeTimer = null;
    rail.addEventListener('pointerenter', () => {
      if (fadeTimer) {
        window.clearTimeout(fadeTimer);
        fadeTimer = null;
      }
      rail.classList.remove('is-fading');
    });

    rail.addEventListener('pointerleave', () => {
      rail.classList.remove('is-collapsed');
      rail.classList.add('is-fading');
      fadeTimer = window.setTimeout(() => {
        rail.classList.remove('is-fading');
        fadeTimer = null;
      }, 180);
    });
  }

  function collapseRail(rail) {
    if (!rail) return;
    rail.classList.add('is-collapsed');
    els.body.classList.remove('is-outline-open', 'is-refs-open');
  }

  function mountRails(outline, refs, handlers, options = {}) {
    const outlineHost = $('#outlineRailSlot');
    const refsHost = $('#refsRailSlot');
    if (!outlineHost || !refsHost) return;

    outlineHost.innerHTML = railTemplate('outline', outline, options);
    refsHost.innerHTML = railTemplate('refs', refs, options);

    const outlineRail = $('#outlineRail');
    const refsRail = $('#refsRail');

    $$('.rail-item', outlineRail).forEach(button => {
      button.addEventListener('click', () => {
        handlers.onOutline(outline[Number(button.dataset.index)]);
      });
    });
    $$('.rail-item', refsRail).forEach(button => {
      button.addEventListener('click', () => {
        handlers.onReference(refs[Number(button.dataset.index)]);
        collapseRail(refsRail);
      });
    });

    bindRailCollapse(outlineRail);
    bindRailCollapse(refsRail);
  }

  async function renderArticle(path, renderId) {
    setViewMode('article');
    const articlePath = normalizePath(path);
    state.articleScrollTrackingPath = '';
    state.currentArticle = articlePath;
    if (state.lastListRoute.type !== 'timeline') state.activeTimelineMonth = '';
    renderArticleLoadingShell();
    scrollPageToTop(renderId);

    const data = await fetchJson('/api/article', { path: articlePath });
    if (!isActiveRender(renderId) || state.currentArticle !== articlePath) return false;
    const { article, content } = data;
    state.activeFolder = article.categoryPath || '';
    expandFolderPath(state.activeFolder);

    if (article.format === 'markdown') {
      renderMarkdownArticle(article, content.markdown || '', renderId);
      return true;
    }

    return renderHtmlArticle(article, content.url, renderId);
  }

  function renderArticleLoadingShell() {
    renderArticleFrameSlots('', { loading: true });
    mountRails([], [], {
      onOutline() {},
      onReference() {}
    });
  }

  function renderArticleFrameSlots(inner, options = {}) {
    cleanupArticleFrame();
    disconnectListObserver();
    clearContentViewState();

    const viewClasses = ['article-view'];
    if (options.loading) viewClasses.push('article-view--loading');
    if (options.preparing) viewClasses.push('article-view--preparing');
    const loadingAttrs = options.loading
      ? 'role="status" aria-label="Loading article"'
      : 'aria-hidden="true"';

    els.content.innerHTML = `
      <div class="${viewClasses.join(' ')}">
        <div id="outlineRailSlot"></div>
        <div class="article-stage">
          <div class="article-loading" ${loadingAttrs}>
            <span class="article-loading__line article-loading__line--meta"></span>
            <span class="article-loading__line article-loading__line--title"></span>
            <span class="article-loading__line"></span>
            <span class="article-loading__line article-loading__line--short"></span>
          </div>
          <div class="article-stage__content">
            ${inner}
          </div>
        </div>
        <div id="refsRailSlot"></div>
      </div>
    `;

    return $('.article-view');
  }

  function renderMarkdownArticle(article, markdown, renderId) {
    const view = renderArticleFrameSlots(`
      <article class="markdown-article">
        <header class="article-heading">
          <div class="article-heading__meta">${renderDisplayPath(article.categoryPath, { rootLabel: 'NOTES' })}<span class="path-separator" aria-hidden="true">·</span>${escapeHtml(article.date || '—')}</div>
          <h1>${escapeHtml(article.title)}</h1>
        </header>
        <div class="markdown-body" id="articleBody">${renderMarkdown(markdown, { articlePath: article.path })}</div>
      </article>
    `, { preparing: true });

    const body = $('#articleBody');
    prepareMarkdownImages(body);
    enableMarkdownHorizontalWheel(body);
    // MathJax 先处理正文；Mermaid 源码仍在 code/pre 中，因此不会被误识别为公式。
    const contentReady = typesetMath(body).then(() => typesetMermaid(body));
    const outline = prepareHeadings(body);
    const refs = prepareReferences(body, window.location.href, 'markdown');
    mountRails(outline, refs, {
      onOutline(item) {
        scrollElementBelowTopbar(item?.element, { behavior: 'smooth' });
      },
      onReference(item) {
        if (item?.href) window.open(item.href, '_blank', 'noopener,noreferrer');
      }
    });
    revealArticleWhenReady(renderId, view, contentReady);
    scheduleArticleScrollRestore(renderId, article.path, contentReady);
  }

  function resizeHtmlFrame(frame, options = {}) {
    const applySize = () => {
      const shouldRestoreScroll = Boolean(options.preserveScroll);
      const scrollX = shouldRestoreScroll ? window.scrollX : 0;
      const scrollY = shouldRestoreScroll ? window.scrollY : 0;

      try {
        const doc = frame.contentDocument;
        if (!doc) return;

        doc.documentElement.style.overflow = 'hidden';
        if (doc.body) doc.body.style.overflow = 'hidden';

        const minHeight = htmlFrameViewportHeight();
        doc.documentElement.style.setProperty('--wvd-vh', `${minHeight}px`);
        frame.style.minHeight = `${minHeight}px`;
        const currentHeight = parseFloat(frame.style.height) || frame.getBoundingClientRect().height || 0;
        if (!currentHeight || currentHeight < minHeight) frame.style.height = `${minHeight}px`;

        const bodyRect = doc.body?.getBoundingClientRect();
        const contentHeight = Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight || 0,
          doc.body?.offsetHeight || 0,
          bodyRect ? Math.ceil(bodyRect.height) : 0,
          minHeight
        );

        const nextHeight = `${Math.ceil(contentHeight)}px`;
        if (frame.style.height !== nextHeight) frame.style.height = nextHeight;
        if (shouldRestoreScroll) {
          window.requestAnimationFrame(() => {
            window.scrollTo({ left: scrollX, top: scrollY, behavior: 'auto' });
          });
        }
      } catch {
        frame.style.minHeight = `${htmlFrameViewportHeight()}px`;
      }
    };

    if (options.sync) {
      applySize();
      return;
    }

    window.requestAnimationFrame(applySize);
  }

  function bindHtmlAnchorNavigation(frame, doc, articleUrl, signal) {
    doc.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const clicked = event.target?.closest ? event.target : event.target?.parentElement;
      const link = clicked?.closest?.('a[href]');
      if (!link) return;

      const targetAttr = String(link.getAttribute('target') || '').trim().toLowerCase();
      if (targetAttr && targetAttr !== '_self') return;

      const hash = articleHashFromHref(link.getAttribute('href'), articleUrl);
      if (hash === null) return;

      event.preventDefault();
      const target = hashTarget(doc, hash);
      if (target) scrollFrameElementBelowTopbar(frame, target, { behavior: 'smooth' });
    }, { capture: true, signal });
  }

  function prepareHtmlFrameSizing(frame, options = {}) {
    const controller = new AbortController();
    const timers = new Set();
    const scrollIdleMs = 320;
    let resizeFrame = 0;
    let lastUserScrollAt = Number.NEGATIVE_INFINITY;
    let hasAppliedInitialSize = false;
    let hasSignaledReady = false;
    let pendingPreserveScroll = false;

    const noteUserScroll = () => {
      lastUserScrollAt = performance.now();
    };
    const resize = preserveScroll => {
      resizeFrame = 0;
      resizeHtmlFrame(frame, { preserveScroll, sync: true });
      hasAppliedInitialSize = true;
      if (!hasSignaledReady) {
        hasSignaledReady = true;
        options.onReady?.();
      }
    };
    const scheduleResize = (delay, options = {}) => {
      const respectScroll = options.respectScroll !== false;
      const preserveScroll = options.preserveScroll ?? hasAppliedInitialSize;
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (controller.signal.aborted) return;

        const scrollElapsed = performance.now() - lastUserScrollAt;
        if (respectScroll && scrollElapsed < scrollIdleMs) {
          scheduleResize(scrollIdleMs - scrollElapsed, options);
          return;
        }

        pendingPreserveScroll = pendingPreserveScroll || preserveScroll;
        if (resizeFrame) return;
        resizeFrame = window.requestAnimationFrame(() => {
          const shouldPreserveScroll = pendingPreserveScroll;
          pendingPreserveScroll = false;
          resize(shouldPreserveScroll);
        });
      }, delay);
      timers.add(timer);
    };

    const bindDocument = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc) return;

        // An iframe emits an initial about:blank load before srcdoc/src is ready.
        // Treating that empty document as ready would restore against a one-screen
        // frame and then overwrite the saved article position with zero.
        const frameHref = frame.contentWindow?.location?.href || '';
        if (frameHref === 'about:blank') return;

        bindHtmlAnchorNavigation(frame, doc, options.articleUrl, controller.signal);
        bridgeHtmlFixedElements(frame, doc, controller.signal);

        doc.addEventListener('wheel', event => {
          if (event.ctrlKey || event.metaKey) return;

          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
          const deltaX = event.deltaX * unit;
          const deltaY = event.deltaY * unit;
          if (!deltaX && !deltaY) return;

          event.preventDefault();
          markScrollIntent();
          noteUserScroll();
          scrollPageBy(deltaX, deltaY);
        }, { passive: false, signal: controller.signal });

        scheduleResize(0, { respectScroll: false, preserveScroll: false });
        scheduleResize(360);
        scheduleResize(1200);

        Array.from(doc.images || []).forEach(image => {
          if (image.complete) return;
          image.addEventListener('load', () => scheduleResize(0), { once: true, signal: controller.signal });
          image.addEventListener('error', () => scheduleResize(0), { once: true, signal: controller.signal });
        });
      } catch {
        scheduleResize(0, { respectScroll: false, preserveScroll: false });
      }
    };

    frame.addEventListener('load', bindDocument, { signal: controller.signal });
    window.addEventListener('resize', () => scheduleResize(80, { respectScroll: false }), { signal: controller.signal });
    window.addEventListener('scroll', noteUserScroll, { passive: true, signal: controller.signal });
    window.addEventListener('wheel', noteUserScroll, { passive: true, signal: controller.signal });
    window.addEventListener('touchmove', noteUserScroll, { passive: true, signal: controller.signal });
    window.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) noteUserScroll();
    }, { signal: controller.signal });

    return () => {
      controller.abort();
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      timers.forEach(timer => window.clearTimeout(timer));
      timers.clear();
    };
  }

  async function renderHtmlArticle(article, url, renderId) {
    const view = renderArticleFrameSlots(`
      <div class="html-article">
        <iframe class="html-article-frame" id="htmlFrame" title="${escapeAttr(article.title)}" scrolling="no"></iframe>
      </div>
    `, { preparing: true });
    scrollPageToTop(renderId);

    mountRails([], [], {
      onOutline() {},
      onReference() {}
    });

    const frame = $('#htmlFrame');
    state.articleCleanup = prepareHtmlFrameSizing(frame, {
      articleUrl: url,
      onReady() {
        revealArticleView(renderId, view);
        restoreArticleScroll(renderId, article.path);
      }
    });
    frame.addEventListener('load', () => {
      if (!isActiveRender(renderId) || state.currentArticle !== normalizePath(article.path)) return;
      try {
        const doc = frame.contentDocument;
        if (!doc) return;
        injectHtmlReferenceStyle(doc);
        const outline = prepareHeadings(doc.body);
        const refs = prepareReferences(doc.body, url, 'html');
        const surfaceTone = htmlArticleSurfaceTone(doc);

        mountRails(outline, refs, {
          onOutline(item) {
            scrollFrameElementBelowTopbar(frame, item?.element, { behavior: 'smooth' });
          },
          onReference(item) {
            if (item?.href) window.open(item.href, '_blank', 'noopener,noreferrer');
          }
        }, { surfaceTone });
      } catch (error) {
        mountRails([], [], {
          onOutline() {},
          onReference() {}
        });
      }
    });

    try {
      const html = await fetchText(url);
      if (!isActiveRender(renderId) || state.currentArticle !== normalizePath(article.path)) return false;
      state.articleScrollTrackingPath = '';
      scrollPageToTop(renderId);
      frame.srcdoc = buildHtmlSrcdoc(html, article);
      return true;
    } catch (error) {
      if (!isActiveRender(renderId) || state.currentArticle !== normalizePath(article.path)) return false;
      console.warn('[html] srcdoc load failed, falling back to iframe src:', error);
      state.articleScrollTrackingPath = '';
      scrollPageToTop(renderId);
      frame.src = url;
      return true;
    }
  }

  function renderError(message) {
    cleanupArticleFrame();
    disconnectListObserver();
    clearContentViewState();
    els.content.innerHTML = `
      <div class="empty">
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  async function render() {
    const renderId = state.renderId + 1;
    const previousRoute = state.route;
    const nextRoute = parseHash();
    const previousListKey = isListRoute(previousRoute) ? listRouteKey(previousRoute) : '';
    const isLeavingListForArticle = previousListKey && nextRoute.type === 'article';
    if (previousRoute?.type === 'article') {
      flushArticleScrollSave();
    }
    if (previousListKey && !isLeavingListForArticle && state.listScrollLockKey !== previousListKey) {
      saveListScroll(previousRoute);
    }
    state.listScrollLockKey = '';
    state.renderId = renderId;
    state.scrollIntentRenderId = 0;
    const shouldRestoreListScroll = previousRoute?.type === 'article' && isListRoute(nextRoute);
    state.route = nextRoute;

    try {
      let didRender = false;
      if (state.route.type === 'latest') {
        didRender = await renderLatest(renderId, { restoreScroll: shouldRestoreListScroll });
      } else if (state.route.type === 'folder') {
        didRender = await renderFolder(state.route.path, renderId, { restoreScroll: shouldRestoreListScroll });
      } else if (state.route.type === 'timeline') {
        didRender = await renderTimelineMonth(state.route.month, renderId, { restoreScroll: shouldRestoreListScroll });
      } else if (state.route.type === 'article') {
        didRender = await renderArticle(state.route.path, renderId);
      }
      if (!didRender || !isActiveRender(renderId)) return;
    } catch (error) {
      if (!isActiveRender(renderId)) return;
      console.error(error);
      renderError(error.data?.error || error.message || '加载失败。');
    }
  }

  function bindGlobalEvents() {
    window.addEventListener('hashchange', render);
    window.addEventListener('resize', updateTimelineIndent);
    document.addEventListener('pointerdown', captureListScrollBeforeArticleNavigation, { capture: true });
    window.addEventListener('wheel', markScrollIntent, { passive: true });
    window.addEventListener('touchmove', markScrollIntent, { passive: true });
    window.addEventListener('scroll', scheduleArticleScrollSave, { passive: true });
    window.addEventListener('pagehide', flushArticleScrollSave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushArticleScrollSave();
    });
    document.addEventListener('pointerdown', () => {
      if (state.route.type === 'article') markScrollIntent();
    }, { capture: true });
    window.addEventListener('keydown', event => {
      if (isScrollKey(event.key)) markScrollIntent();
    });

    els.brandLink.addEventListener('click', event => {
      event.preventDefault();
      closeAllFolders();
      state.sidebarMode = 'index';
      els.body.classList.remove('is-index-open', 'is-outline-open', 'is-refs-open');
      setRoute('latest');
    });

    els.backBtn.addEventListener('click', () => {
      if (state.lastListRoute.type === 'folder') {
        setRoute('folder', state.lastListRoute.path);
        return;
      }
      if (state.lastListRoute.type === 'timeline') {
        setRoute('timeline', state.lastListRoute.month);
        return;
      }
      setRoute('latest');
    });

    els.indexBtn.addEventListener('click', () => {
      els.body.classList.toggle('is-index-open');
    });

    els.indexTab?.addEventListener('click', () => {
      state.sidebarMode = 'index';
      renderSidebarPanel();
    });

    els.timelineTab?.addEventListener('click', () => {
      state.sidebarMode = 'timeline';
      renderSidebarPanel();
    });

    els.mobileRailActions.addEventListener('click', event => {
      const button = event.target.closest('button[data-rail]');
      if (!button) return;
      const rail = button.dataset.rail;
      els.body.classList.toggle('is-outline-open', rail === 'outline' && !els.body.classList.contains('is-outline-open'));
      els.body.classList.toggle('is-refs-open', rail === 'refs' && !els.body.classList.contains('is-refs-open'));
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        els.body.classList.remove('is-index-open', 'is-outline-open', 'is-refs-open');
      }
    });

  }

  async function boot() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    bindGlobalEvents();
    await Promise.all([loadTree(), loadTimeline()]);
    await render();
  }

  boot().catch(error => {
    console.error(error);
    renderError(error.message || '启动失败。');
  });
})();
