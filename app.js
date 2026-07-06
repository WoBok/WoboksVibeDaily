(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    tree: [],
    totalArticles: 0,
    currentFolder: '',
    activeFolder: '',
    currentArticle: '',
    openFolders: new Set(),
    lastListRoute: { type: 'latest' },
    route: { type: 'latest' },
    reloadTimer: 0
  };

  const els = {
    body: document.body,
    tree: $('#tree'),
    content: $('#content'),
    sidebar: $('#sidebar'),
    backBtn: $('#backBtn'),
    indexBtn: $('#indexBtn'),
    mobileRailActions: $('#mobileRailActions')
  };

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

  function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/');
  }

  function displayPath(path) {
    return normalizePath(path)
      .split('/')
      .filter(Boolean)
      .join(' · ');
  }

  function pathBasename(path) {
    const parts = normalizePath(path).split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Latest';
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

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { type: 'latest' };

    if (raw.startsWith('folder/')) {
      return { type: 'folder', path: decodeURIComponent(raw.slice('folder/'.length)) };
    }

    if (raw.startsWith('article/')) {
      return { type: 'article', path: decodeURIComponent(raw.slice('article/'.length)) };
    }

    return { type: 'latest' };
  }

  function routeHash(type, path) {
    if (type === 'latest') return '#/';
    return `#/${type}/${encodeURIComponent(path)}`;
  }

  function setRoute(type, path) {
    const next = routeHash(type, path);
    if (location.hash === next) render();
    else location.hash = next;
  }

  function expandFolderPath(path) {
    const parts = normalizePath(path).split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (acc !== 'posts') state.openFolders.add(acc);
    }
  }

  function setViewMode(mode) {
    els.body.classList.toggle('is-article-mode', mode === 'article');
    els.body.classList.remove('is-index-open', 'is-outline-open', 'is-refs-open');
    els.backBtn.hidden = mode !== 'article';
    els.mobileRailActions.hidden = mode !== 'article';
  }

  async function loadTree() {
    const data = await fetchJson('/api/tree');
    state.tree = data.tree || [];
    state.totalArticles = data.totalArticles || 0;
  }

  function renderTree() {
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
    const isActive = state.activeFolder === node.path;
    const isSelectedPath = state.activeFolder
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
      state.activeFolder = node.path;

      if (hasChildren) {
        if (isOpen) state.openFolders.delete(node.path);
        else state.openFolders.add(node.path);
        renderTree();
        return;
      }

      if (isClickableLeaf) {
        state.currentFolder = node.path;
        els.body.classList.remove('is-index-open');
        setRoute('folder', node.path);
      }
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

  function renderListShell(title, eyebrow, articles) {
    const summary = articles.length === 1 ? '1 note' : `${articles.length} notes`;
    els.content.innerHTML = `
      <div class="list-view">
        <header class="list-view__header">
          <div class="list-view__eyebrow">${escapeHtml(eyebrow)}</div>
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
      </div>
    `;
  }

  function renderArticleCard(article, index) {
    return `
      <a class="post-card" href="${routeHash('article', article.path)}" style="animation-delay:${index * 45}ms">
        <div class="post-card__meta">
          <span>${escapeHtml(article.date || '—')}</span>
          <span>${escapeHtml(article.categoryName || '')}</span>
        </div>
        <h2 class="post-card__title">${escapeHtml(article.title)}</h2>
        ${article.summary ? `<p class="post-card__summary">${escapeHtml(article.summary)}</p>` : ''}
      </a>
    `;
  }

  async function renderLatest() {
    setViewMode('list');
    state.currentFolder = '';
    state.activeFolder = '';
    state.currentArticle = '';
    state.lastListRoute = { type: 'latest' };
    const data = await fetchJson('/api/latest');
    renderListShell('Latest', 'HOME', data.articles || []);
  }

  async function renderFolder(path) {
    setViewMode('list');
    state.currentFolder = normalizePath(path);
    state.activeFolder = state.currentFolder;
    state.currentArticle = '';
    state.lastListRoute = { type: 'folder', path: state.currentFolder };
    expandFolderPath(state.currentFolder);

    const data = await fetchJson('/api/folder', { path: state.currentFolder });
    renderListShell(pathBasename(state.currentFolder), displayPath(state.currentFolder), data.articles || []);
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

  function renderInlineMarkdown(value) {
    const inlineMath = [];
    let html = String(value || '').replace(/\$([^$\n]+?)\$/g, (_match, body) => {
      const token = `@@MATH_${inlineMath.length}@@`;
      inlineMath.push(`<span class="math-inline">$${escapeHtml(body)}$</span>`);
      return token;
    });

    html = escapeHtml(html);
    const code = [];

    html = html.replace(/`([^`]+)`/g, (_match, body) => {
      const token = `@@CODE_${code.length}@@`;
      code.push(`<code>${body}</code>`);
      return token;
    });

    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy">`;
    });

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      return `<a href="${escapeAttr(href)}">${label}</a>`;
    });

    html = html
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

    code.forEach((snippet, index) => {
      html = html.replace(`@@CODE_${index}@@`, snippet);
    });

    inlineMath.forEach((snippet, index) => {
      html = html.replace(`@@MATH_${index}@@`, snippet);
    });

    return html;
  }

  function renderMarkdown(markdown) {
    const { body } = parseFrontmatter(markdown);
    const lines = body.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let list = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    };

    const flushList = () => {
      if (!list) return;
      html.push(`<${list.type}>${list.items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
      list = null;
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }

      if (trimmed.startsWith('$') && !trimmed.endsWith('$')) {
        flushParagraph();
        flushList();
        const math = [line];
        i += 1;
        while (i < lines.length) {
          math.push(lines[i]);
          if (lines[i].trim().endsWith('$')) break;
          i += 1;
        }
        html.push(`<div class="math-block">${escapeHtml(math.join('\n'))}</div>`);
        continue;
      }

      if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length > 1) {
        flushParagraph();
        flushList();
        html.push(`<div class="math-block">${escapeHtml(line)}</div>`);
        continue;
      }

      const fence = trimmed.match(/^```(\w*)/);
      if (fence) {
        flushParagraph();
        flushList();
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
        flushList();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        flushParagraph();
        flushList();
        html.push('<hr>');
        continue;
      }

      const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
      if (unordered) {
        flushParagraph();
        if (!list || list.type !== 'ul') {
          flushList();
          list = { type: 'ul', items: [] };
        }
        list.items.push(unordered[1]);
        continue;
      }

      const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        if (!list || list.type !== 'ol') {
          flushList();
          list = { type: 'ol', items: [] };
        }
        list.items.push(ordered[1]);
        continue;
      }

      const quote = trimmed.match(/^>\s?(.+)$/);
      if (quote) {
        flushParagraph();
        flushList();
        html.push(`<blockquote><p>${renderInlineMarkdown(quote[1])}</p></blockquote>`);
        continue;
      }

      paragraph.push(trimmed);
    }

    flushParagraph();
    flushList();
    return html.join('\n');
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

  function prepareReferences(root, baseUrl, mode) {
    const refs = [];
    $$('a[href]', root).forEach(link => {
      if (link.querySelector('img')) return;
      if (!isExternalLink(link, baseUrl)) return;
      const index = refs.length + 1;
      link.dataset.wvdRef = String(index);

      if (mode === 'markdown') {
        const sup = document.createElement('sup');
        sup.className = 'ref-mark';
        sup.textContent = String(index);
        link.appendChild(sup);
      }

      refs.push({
        index,
        text: linkLabel(link),
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

  function railTemplate(type, items) {
    const emptyText = type === 'outline' ? 'No headings' : 'No refs';
    return `
      <aside class="article-rail article-rail--${type}" id="${type}Rail">
        <div class="article-rail__inner">
          ${items.length ? items.map((item, index) => `
            <button class="rail-item rail-item--level-${item.level || 1}" type="button" data-index="${index}">
              <span class="rail-item__line" aria-hidden="true"></span>
              <span class="rail-item__text">${type === 'refs' ? `${item.index}. ` : ''}${escapeHtml(item.text)}</span>
            </button>
          `).join('') : `<div class="rail-empty">${emptyText}</div>`}
        </div>
      </aside>
    `;
  }

  function bindRailDock(rail) {
    if (!rail) return;
    const items = $$('.rail-item', rail);
    rail.addEventListener('pointermove', event => {
      items.forEach(item => {
        const rect = item.getBoundingClientRect();
        const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
        const scale = 1 + Math.max(0, 1 - distance / 120) * 0.24;
        item.style.setProperty('--dock-scale', scale.toFixed(3));
      });
    });
    rail.addEventListener('pointerleave', () => {
      items.forEach(item => item.style.setProperty('--dock-scale', '1'));
    });
  }

  function mountRails(outline, refs, handlers) {
    const outlineHost = $('#outlineRailSlot');
    const refsHost = $('#refsRailSlot');
    if (!outlineHost || !refsHost) return;

    outlineHost.innerHTML = railTemplate('outline', outline);
    refsHost.innerHTML = railTemplate('refs', refs);

    const outlineRail = $('#outlineRail');
    const refsRail = $('#refsRail');

    $$('.rail-item', outlineRail).forEach(button => {
      button.addEventListener('click', () => handlers.onOutline(outline[Number(button.dataset.index)]));
    });
    $$('.rail-item', refsRail).forEach(button => {
      button.addEventListener('click', () => handlers.onReference(refs[Number(button.dataset.index)]));
    });

    bindRailDock(outlineRail);
    bindRailDock(refsRail);
  }

  async function renderArticle(path) {
    setViewMode('article');
    state.currentArticle = normalizePath(path);

    const data = await fetchJson('/api/article', { path: state.currentArticle });
    const { article, content } = data;
    state.currentFolder = article.categoryPath || '';
    state.activeFolder = state.currentFolder;
    expandFolderPath(state.currentFolder);

    if (article.format === 'markdown') {
      renderMarkdownArticle(article, content.markdown || '');
      return;
    }

    renderHtmlArticle(article, content.url);
  }

  function renderArticleFrameSlots(inner) {
    els.content.innerHTML = `
      <div class="article-view">
        <div id="outlineRailSlot"></div>
        <div class="article-stage">
          ${inner}
        </div>
        <div id="refsRailSlot"></div>
      </div>
    `;
  }

  function renderMarkdownArticle(article, markdown) {
    renderArticleFrameSlots(`
      <article class="markdown-article">
        <header class="article-heading">
          <div class="article-heading__meta">${escapeHtml(displayPath(article.categoryPath))} · ${escapeHtml(article.date || '—')}</div>
          <h1>${escapeHtml(article.title)}</h1>
        </header>
        <div class="markdown-body" id="articleBody">${renderMarkdown(markdown)}</div>
      </article>
    `);

    const body = $('#articleBody');
    const outline = prepareHeadings(body);
    const refs = prepareReferences(body, window.location.href, 'markdown');
    mountRails(outline, refs, {
      onOutline(item) {
        item?.element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onReference(item) {
        if (item?.href) window.open(item.href, '_blank', 'noopener,noreferrer');
      }
    });
  }

  function renderHtmlArticle(article, url) {
    renderArticleFrameSlots(`
      <div class="html-article">
        <iframe class="html-article-frame" id="htmlFrame" src="${escapeAttr(url)}" title="${escapeAttr(article.title)}"></iframe>
      </div>
    `);

    mountRails([], [], {
      onOutline() {},
      onReference() {}
    });

    const frame = $('#htmlFrame');
    frame.addEventListener('load', () => {
      try {
        const doc = frame.contentDocument;
        if (!doc) return;
        injectHtmlReferenceStyle(doc);
        const outline = prepareHeadings(doc.body);
        const refs = prepareReferences(doc.body, frame.src, 'html');

        mountRails(outline, refs, {
          onOutline(item) {
            item?.element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
          onReference(item) {
            if (item?.href) window.open(item.href, '_blank', 'noopener,noreferrer');
          }
        });
      } catch (error) {
        mountRails([], [], {
          onOutline() {},
          onReference() {}
        });
      }
    });
  }

  function renderError(message) {
    els.content.innerHTML = `
      <div class="empty">
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  async function render() {
    state.route = parseHash();

    try {
      if (state.route.type === 'latest') {
        await renderLatest();
      } else if (state.route.type === 'folder') {
        await renderFolder(state.route.path);
      } else if (state.route.type === 'article') {
        await renderArticle(state.route.path);
      }
      renderTree();
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
      console.error(error);
      renderError(error.data?.error || error.message || '加载失败。');
    }
  }

  function bindGlobalEvents() {
    window.addEventListener('hashchange', render);

    els.backBtn.addEventListener('click', () => {
      if (state.lastListRoute.type === 'folder') {
        setRoute('folder', state.lastListRoute.path);
        return;
      }
      setRoute('latest');
    });

    els.indexBtn.addEventListener('click', () => {
      els.body.classList.toggle('is-index-open');
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

    window.addEventListener('focus', () => {
      clearTimeout(state.reloadTimer);
      state.reloadTimer = setTimeout(async () => {
        await loadTree();
        await render();
      }, 120);
    });
  }

  function renderDate() {
    const target = $('#topDate');
    if (!target) return;
    target.textContent = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  async function boot() {
    renderDate();
    bindGlobalEvents();
    await loadTree();
    await render();
  }

  boot().catch(error => {
    console.error(error);
    renderError(error.message || '启动失败。');
  });
})();
