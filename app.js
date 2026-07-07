/* =========================================================
   WoBok's Vibe Daily — front-end (refactor-design §9–§13)
   - hash 路由：#/ (Latest) | #/folder/<path> | #/article/<path>
   - 目录树：墨绿圆点，选中路径浅绿
   - Markdown 前端渲染（markdown-it + KaTeX + highlight.js + DOMPurify）
   - HTML 文章 iframe 原样加载 + 轻量链接脚注
   - 左右 Overlay：大纲 / 引用，Mac Dock 缩放
   ========================================================= */

(() => {
  'use strict';

  window.addEventListener('error', (e) => console.error('[ERR]', e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[REJ]', e.reason));

  // ---------- utils ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };
  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
  const escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return res.json();
  }

  function displayName(name) {
    return name.replace(/^0x[0-9A-Fa-f]+\s*-\s*/, '').trim() || name;
  }

  // ---------- state ----------
  const state = {
    tree: null,
    totalArticles: 0,
    openFolders: new Set(),
    activeLeafPath: null,
    lastList: 'latest',
    currentArticle: null,
    md: null,
  };

  // ---------- routing ----------
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { type: 'latest' };
    if (raw.startsWith('folder/')) return { type: 'folder', path: decodeURIComponent(raw.slice('folder/'.length)) };
    if (raw.startsWith('article/')) return { type: 'article', path: decodeURIComponent(raw.slice('article/'.length)) };
    return { type: 'latest' };
  }
  const goLatest = () => (location.hash = '#/');
  const goFolder = (p) => (location.hash = '#/folder/' + encodePath(p));
  const goArticle = (p) => (location.hash = '#/article/' + encodePath(p));

  // ---------- tree ----------
  async function loadTree() {
    const data = await getJSON('/api/tree');
    state.tree = data.tree;
    state.totalArticles = data.totalArticles;
  }

  function activePathSet() {
    const set = new Set();
    if (!state.activeLeafPath) return set;
    const parts = state.activeLeafPath.split('/').filter(Boolean);
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      acc = i === 0 ? parts[i] : acc + '/' + parts[i];
      set.add(acc);
    }
    return set;
  }

  function expandToPath(path) {
    const parts = path.split('/').filter(Boolean);
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = i === 0 ? parts[i] : acc + '/' + parts[i];
      state.openFolders.add(acc);
    }
  }

  function renderTree() {
    const tree = $('#tree');
    if (!state.tree) return;
    tree.innerHTML = '';
    const active = activePathSet();
    state.tree.forEach((n) => tree.appendChild(renderNode(n, active)));
  }

  function renderNode(node, active) {
    const wrap = el('div', 'tree-node');
    if (state.openFolders.has(node.path)) wrap.classList.add('is-open');
    if (active.has(node.path)) wrap.classList.add('is-active-path');

    const row = el('div', 'tree-node__row');
    const dot = el('span', 'tree-node__dot');
    const label = el('span', 'tree-node__label');
    label.textContent = node.displayName;
    const count = el('span', 'tree-node__count');
    count.textContent = node.articleCount;
    row.append(dot, label, count);

    const hasChildren = node.children && node.children.length > 0;
    const isEmptyLeaf = node.isLeaf && node.articleCount === 0;

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hasChildren) {
        if (state.openFolders.has(node.path)) state.openFolders.delete(node.path);
        else state.openFolders.add(node.path);
        renderTree();
      } else if (node.isLeaf && node.articleCount > 0) {
        goFolder(node.path);
      }
      // 空叶子目录：点击无反应
    });
    if (isEmptyLeaf) {
      row.addEventListener('pointerdown', () => row.classList.add('is-press'));
      const release = () => row.classList.remove('is-press');
      row.addEventListener('pointerup', release);
      row.addEventListener('pointerleave', release);
    }
    wrap.appendChild(row);

    if (hasChildren) {
      const cw = el('div', 'tree-node__children');
      const inner = el('div');
      node.children.forEach((c) => inner.appendChild(renderNode(c, active)));
      cw.appendChild(inner);
      wrap.appendChild(cw);
    }
    return wrap;
  }

  // ---------- list views ----------
  function breadcrumbHTML(categoryPath) {
    const parts = (categoryPath || '').split('/').filter(Boolean).slice(1); // 去掉 'posts'
    return parts.map(displayName).join('  /  ');
  }

  function renderArticleList(articles) {
    const items = el('div', 'list-view__items');
    if (!articles.length) {
      items.innerHTML = `<div class="empty"><div class="empty__deco">✦</div><p>这里还没有文章。</p></div>`;
      return items;
    }
    articles.forEach((a, i) => {
      const card = el('a', 'post-card');
      card.href = '#/article/' + encodePath(a.path);
      card.style.animationDelay = i * 50 + 'ms';
      card.innerHTML = `
        <div class="post-card__body">
          <div class="post-card__meta">
            <span>${escapeHTML(a.date || '—')}</span>
            <span class="post-card__meta-dot"></span>
            <span>${escapeHTML(a.format === 'html' ? 'HTML' : 'MD')}</span>
          </div>
          <h2 class="post-card__title">${escapeHTML(a.title)}</h2>
          <p class="post-card__summary">${escapeHTML(a.summary || '')}</p>
        </div>`;
      items.appendChild(card);
    });
    return items;
  }

  async function renderLatest() {
    state.activeLeafPath = null;
    state.lastList = 'latest';
    let articles = [];
    try {
      articles = await getJSON('/api/latest');
    } catch (e) {
      return renderError('无法加载 Latest：' + e.message);
    }
    const content = $('#content');
    content.innerHTML = '';
    const view = el('div', 'list-view');
    view.innerHTML = `
      <div class="list-view__header">
        <div class="list-view__breadcrumb">ALL NOTES · ${articles.length}</div>
        <h1 class="list-view__title"><em>Latest</em></h1>
        <p class="list-view__lede">全站笔记，按时间倒序排列。</p>
      </div>`;
    view.appendChild(renderArticleList(articles));
    content.appendChild(view);
    setTopRight('');
  }

  async function renderFolder(path) {
    state.activeLeafPath = path;
    state.lastList = path;
    expandToPath(path);
    let data;
    try {
      data = await getJSON('/api/folder?path=' + encodeURIComponent(path));
    } catch (e) {
      return renderError('无法加载目录：' + e.message);
    }
    if (data.error) {
      return renderError(data.error === 'NOT_LEAF_FOLDER' ? '不是叶子目录。' : '目录无效。');
    }
    const content = $('#content');
    content.innerHTML = '';
    const view = el('div', 'list-view');
    view.innerHTML = `
      <div class="list-view__header">
        <div class="list-view__breadcrumb">${escapeHTML(breadcrumbHTML(path))}</div>
        <h1 class="list-view__title"><em>${escapeHTML(data.folder.displayName)}</em></h1>
        <p class="list-view__lede">${data.articles.length} 篇笔记。</p>
      </div>`;
    view.appendChild(renderArticleList(data.articles));
    content.appendChild(view);
    setTopRight('');
  }

  // ---------- article views ----------
  async function renderArticle(path) {
    state.currentArticle = path;
    const leafPath = path.lastIndexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : 'posts';
    state.activeLeafPath = leafPath;
    expandToPath(leafPath);

    let data;
    try {
      data = await getJSON('/api/article?path=' + encodeURIComponent(path));
    } catch (e) {
      return renderError('找不到这篇文章。');
    }
    if (!data) return renderError('找不到这篇文章。');

    setTopRight(`<button class="back-button" id="backBtn"><span class="back-arrow">←</span> Back</button>`);
    $('#backBtn').addEventListener('click', goBack);

    if (data.article.format === 'html') {
      await renderHtmlArticle(data);
    } else {
      await renderMarkdownArticle(data);
    }
  }

  function goBack() {
    if (state.lastList && state.lastList !== 'latest') goFolder(state.lastList);
    else goLatest();
  }

  async function renderMarkdownArticle(data) {
    const a = data.article;
    const content = $('#content');
    content.innerHTML = '';
    const view = el('div', 'article-view');
    const shell = el('div', 'article-shell');
    shell.innerHTML = `
      <div class="article-headline">
        <div class="article-headline__meta">${escapeHTML(breadcrumbHTML(a.categoryPath))} · ${escapeHTML(a.date || '—')}</div>
        <h1 class="article-headline__title">${escapeHTML(a.title)}</h1>
      </div>
      <div class="markdown-body" id="mdBody"></div>`;
    view.appendChild(shell);
    content.appendChild(view);

    const raw = (data.content && data.content.markdown) || '';
    const body = stripFrontmatter(raw);
    $('#mdBody').innerHTML = renderMarkdown(body);
    if (window.hljs) $$('#mdBody pre code').forEach((b) => { try { hljs.highlightElement(b); } catch (e) {} });
    buildOutlineFromDOM($('#mdBody'), null);
    buildRefsFromDOM($('#mdBody'), 'markdown', null);
    showRails();
  }

  async function renderHtmlArticle(data) {
    const a = data.article;
    const content = $('#content');
    content.innerHTML = '';
    const view = el('div', 'article-view article-view--html');
    const frame = el('iframe', 'html-article-frame');
    frame.title = a.title;
    frame.src = data.content.url;
    view.appendChild(frame);
    content.appendChild(view);

    frame.addEventListener('load', () => {
      try {
        const doc = frame.contentDocument;
        if (!doc) return;
        injectIframeStyle(doc);
        buildOutlineFromDOM(doc.body, doc);
        buildRefsFromDOM(doc.body, 'html', doc);
        showRails();
      } catch (err) {
        console.error('[iframe] load error:', err);
        showRails();
      }
    });
  }

  // ---------- markdown rendering ----------
  function getMD() {
    if (state.md) return state.md;
    state.md = window.markdownit({
      html: true,
      linkify: true,
      breaks: false,
      typographer: false,
    });
    return state.md;
  }

  function stripFrontmatter(text) {
    const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return m ? text.slice(m[0].length) : text;
  }

  function extractMath(src) {
    const math = [];
    src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => {
      math.push({ tex, display: true });
      return `@@WVD_MATH_${math.length - 1}@@`;
    });
    src = src.replace(/\$([\s\S]+?)\$/g, (m, tex, offset) => {
      math.push({ tex, display: isDisplay(src, m, offset, tex) });
      return `@@WVD_MATH_${math.length - 1}@@`;
    });
    return { src, math };
  }

  function isDisplay(full, match, offset, tex) {
    if (/\n/.test(tex) || /\\begin\{/.test(tex)) return true;
    const lineStart = full.lastIndexOf('\n', offset - 1) + 1;
    const endIdx = full.indexOf('\n', offset + match.length);
    const lineEnd = endIdx === -1 ? full.length : endIdx;
    const before = full.slice(lineStart, offset);
    const after = full.slice(offset + match.length, lineEnd);
    return /^\s*$/.test(before) && /^\s*$/.test(after);
  }

  function renderMarkdown(src) {
    const { src: cleaned, math } = extractMath(src);
    let html = getMD().render(cleaned);
    if (window.DOMPurify) {
      html = DOMPurify.sanitize(html, {
        ADD_TAGS: ['font', 'span', 'div'],
        ADD_ATTR: ['style', 'color', 'face', 'size', 'align', 'data-wvd-ref'],
      });
    }
    if (window.katex) {
      html = html.replace(/@@WVD_MATH_(\d+)@@/g, (_m, i) => {
        const item = math[+i];
        if (!item) return '';
        try {
          return katex.renderToString(item.tex, {
            displayMode: item.display,
            throwOnError: false,
            output: 'html',
          });
        } catch (e) {
          return `<span class="math-error">${escapeHTML(item.tex)}</span>`;
        }
      });
    } else {
      html = html.replace(/@@WVD_MATH_(\d+)@@/g, (_m, i) => escapeHTML(math[+i] ? '$' + math[+i].tex + '$' : ''));
    }
    return html;
  }

  // ---------- outline ----------
  function buildOutlineFromDOM(root, docCtx) {
    const headings = $$('h1,h2,h3,h4,h5,h6', root);
    const items = headings.map((h, i) => {
      if (!h.id) h.id = 'wvd-h-' + (docCtx ? 'if' : 'md') + '-' + i;
      return { level: +h.tagName[1], text: h.textContent.trim(), id: h.id };
    });
    renderRail($('#outlineInner'), items, (item) => {
      const doc = docCtx || document;
      const t = doc.getElementById(item.id);
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- references ----------
  function buildRefsFromDOM(root, kind, docCtx) {
    const anchors = $$('a[href]', root);
    const refs = [];
    let idx = 0;
    anchors.forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return; // 仅外部链接
      if (/^(mailto:|tel:)/i.test(href)) return;
      if (a.querySelector('img') && !a.textContent.trim()) return; // 排除纯图片链接
      idx += 1;
      a.setAttribute('data-wvd-ref', String(idx));
      refs.push({ index: idx, text: a.textContent.trim() || href, href });
    });
    const railItems = refs.map((r) => ({
      level: 2,
      text: r.index + '. ' + r.text,
      href: r.href,
    }));
    renderRail($('#refsInner'), railItems, (item) => {
      if (item.href) window.open(item.href, '_blank', 'noopener');
    });
    void kind;
  }

  function renderRail(container, items, onClick) {
    container.innerHTML = '';
    if (!items.length) {
      container.appendChild(el('div', 'rail__empty'));
      return;
    }
    items.forEach((item) => {
      const it = el('div', 'rail-item');
      it.dataset.level = Math.min(6, Math.max(1, item.level || 2));
      const line = el('span', 'rail-item__line');
      const text = el('span', 'rail-item__text');
      text.textContent = item.text;
      it.append(line, text);
      it.addEventListener('click', () => onClick(item));
      container.appendChild(it);
    });
  }

  // HTML iframe 内注入轻量链接脚注样式（refactor-design §10.3）
  function injectIframeStyle(doc) {
    const style = doc.createElement('style');
    style.textContent = `
      a[data-wvd-ref] { position: relative; text-decoration-line: underline; text-decoration-style: dotted; text-underline-offset: 0.18em; }
      a[data-wvd-ref]::before {
        content: attr(data-wvd-ref); position: absolute; left: -0.65em; top: -0.75em;
        font-size: 0.62em; line-height: 1; opacity: 0.7;
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  // ---------- rail dock zoom ----------
  function bindRail(rail) {
    rail.addEventListener('pointermove', (e) => {
      const py = e.clientY;
      $$('.rail-item', rail).forEach((item) => {
        const r = item.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        const dist = Math.abs(py - cy);
        const scale = 1 + Math.max(0, 1 - dist / 120) * 0.45;
        item.style.setProperty('--scale', scale.toFixed(3));
      });
    });
    rail.addEventListener('mouseenter', () => rail.classList.add('is-expanded'));
    rail.addEventListener('mouseleave', () => {
      rail.classList.remove('is-expanded');
      $$('.rail-item', rail).forEach((i) => i.style.setProperty('--scale', '1'));
    });
  }

  function showRails() {
    $('#outlineRail').setAttribute('aria-hidden', 'false');
    $('#refsRail').setAttribute('aria-hidden', 'false');
  }
  function hideRails() {
    $('#outlineRail').setAttribute('aria-hidden', 'true');
    $('#refsRail').setAttribute('aria-hidden', 'true');
    $('#outlineRail').classList.remove('is-expanded', 'is-open');
    $('#refsRail').classList.remove('is-expanded', 'is-open');
  }

  // ---------- top right ----------
  function setTopRight(html) {
    $('#topRight').innerHTML = html;
  }
  function renderError(msg) {
    $('#content').innerHTML = `<div class="error">${escapeHTML(msg)}</div>`;
    setTopRight('');
    hideRails();
  }

  // ---------- main render ----------
  async function render() {
    const route = parseHash();
    hideRails();
    document.body.classList.toggle('is-article', route.type === 'article');
    $('#sidebar').classList.remove('is-hidden');
    if (route.type === 'latest') {
      await renderLatest();
    } else if (route.type === 'folder') {
      await renderFolder(route.path);
    } else if (route.type === 'article') {
      $('#sidebar').classList.add('is-hidden');
      await renderArticle(route.path);
    }
    renderTree();
  }

  window.addEventListener('hashchange', render);

  function bindToggles() {
    $('#outlineToggle').addEventListener('click', () => $('#outlineRail').classList.toggle('is-open'));
    $('#refsToggle').addEventListener('click', () => $('#refsRail').classList.toggle('is-open'));
  }

  // ---------- boot ----------
  (async () => {
    bindRail($('#outlineRail'));
    bindRail($('#refsRail'));
    bindToggles();
    try {
      await loadTree();
      await render();
    } catch (err) {
      console.error('[BOOT]', err);
      $('#content').innerHTML = `<div class="error">启动失败：${escapeHTML(err.message)}<br>请确认 Node 服务已启动 (node server/index.js)。</div>`;
    }
  })();
})();
