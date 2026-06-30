/* =========================================================
   WoBok's Vibe Daily
   - 单页应用（hash 路由）
   - 左侧目录树：仅显示文件夹，数字 = 直接子文件数
   - 右侧列表：当前文件夹的"直接子文件"
   - 文章视图：占页面 3/5 居中
   ========================================================= */

(() => {
  'use strict';

  // 调试：把错误挂到 window
  window.addEventListener('error', e => {
    console.error('[WINDOW ERROR]', e.message, '@', e.filename + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', e => {
    console.error('[UNHANDLED PROMISE]', e.reason);
  });

  // ---------- 工具 ----------
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // 把文件名转为可读标题：on-quietness.html → "On Quietness"
  const titleFromFilename = (name) => {
    const base = name.replace(/\.html$/i, '');
    return base
      .replace(/^\d{4}-\d{2}-\d{2}-?/, '')       // 去掉日期前缀
      .replace(/[_-]+/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  // 文件夹名转显示名
  const folderDisplayName = (name) => {
    const map = {
      'essays': 'Essays',
      'technical': 'Technical',
      'notes': 'Notes',
      'reading': 'Reading',
      'fragments': 'Fragments',
      'diary': 'Diary',
      'code-snippets': 'Snippets',
      'projects': 'Projects',
      'library': 'Library',
      '2026': '2026',
      '2025': '2025',
    };
    return map[name] || titleFromFilename(name);
  };

  // ---------- 状态 ----------
  const state = {
    manifest: null,             // 整棵目录树
    currentFolder: 'posts',     // 当前选中的文件夹路径
    currentArticle: null,       // 当前打开的文章路径（文件级）
    openFolders: new Set(),     // 当前展开的文件夹（每层独立）
  };

  // ---------- 路由 ----------
  // hash 格式：
  //   #/                       → 根目录（posts）
  //   #/essays                 → 进入 essays 文件夹
  //   #/essays/on-quietness    → 打开文章
  const parseHash = () => {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { type: 'folder', path: 'posts' };
    const parts = raw.split('/').filter(Boolean);
    if (parts[parts.length - 1].toLowerCase().endsWith('.html')) {
      return { type: 'article', path: parts.join('/') };
    }
    return { type: 'folder', path: parts.join('/') || 'posts' };
  };

  const setHash = (path) => {
    const newHash = '#/' + path.replace(/^\/+/, '');
    if (location.hash !== newHash) location.hash = newHash;
  };

  // ---------- 加载 manifest ----------
  const loadManifest = async () => {
    try {
      const res = await fetch('manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.manifest = await res.json();
    } catch (err) {
      console.error('[manifest] load failed:', err);
      const tree = $('#tree');
      tree.innerHTML = `<div class="empty">
        <div class="empty__deco">⌘</div>
        <p>未找到 manifest.json。<br>请运行 <code>_build_manifest.py</code> 重新生成。</p>
      </div>`;
    }
  };

  // ---------- 找节点 ----------
  // path 形如 'posts'、'posts/essays'、'posts/essays/on-quietness.html'
  const findNode = (path) => {
    if (!state.manifest) return null;
    const parts = path.split('/').filter(Boolean);
    let node = state.manifest;
    for (const part of parts) {
      if (node === state.manifest && part === 'posts') {
        continue;
      }
      if (!node || !node.children) return null;
      node = node.children.find(c => c.name === part);
      if (!node) return null;
    }
    return node;
  };

  // ---------- 工具：计算后代 .html 数量（用于判断"可点击"） ----------
  const descendantFileCount = (folderNode) => {
    if (!folderNode) return 0;
    let n = 0;
    const walk = (node) => {
      if (!node.children) return;
      for (const c of node.children) {
        if (c.type === 'file') n++;
        else walk(c);
      }
    };
    walk(folderNode);
    return n;
  };

  // ---------- 工具：计算直接子文件数（用于目录数字） ----------
  // 直接子文件 = children 中 type==='file' 的数量
  const directFileCount = (folderNode) => {
    if (!folderNode || !folderNode.children) return 0;
    return folderNode.children.filter(c => c.type === 'file').length;
  };

  // ---------- 渲染侧栏树（仅文件夹） ----------
  const renderTree = () => {
    const tree = $('#tree');
    if (!state.manifest) return;

    const renderNode = (node, depth = 0) => {
      // 文件夹节点
      if (node.type !== 'folder') return null;

      const wrap = document.createElement('div');
      wrap.className = 'tree-node tree-node--folder';

      const fullPath = node.path || node.name;
      const isOpen = state.openFolders.has(fullPath);
      const isActive = state.currentFolder === fullPath;
      const directFiles = directFileCount(node);
      const descendantFiles = descendantFileCount(node);
      const hasChildren = !!(node.children && node.children.length > 0);
      // 「有点击响应」= 任一后代有 .html 文件
      const isClickable = descendantFiles > 0;

      if (isOpen) wrap.classList.add('is-open');
      if (isActive) wrap.classList.add('is-active');

      const row = document.createElement('div');
      row.className = 'tree-node__row';
      row.innerHTML = `
        <svg class="tree-node__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 6l6 6-6 6"/>
        </svg>
        <span class="tree-node__label">${folderDisplayName(node.name)}</span>
        <span class="tree-node__count">${directFiles}</span>
      `;
      row.addEventListener('click', (e) => {
        e.stopPropagation();

        // 1) 展开/收起（独立控制）—— 所有文件夹都可展开
        if (state.openFolders.has(fullPath)) {
          state.openFolders.delete(fullPath);
        } else {
          state.openFolders.add(fullPath);
        }

        // 2) 切到该文件夹（只有当里面有文件时才切）
        if (isClickable) {
          setHash(fullPath);
        } else {
          // 空文件夹：仅刷新树（让 UI 状态更新），不触发路由
          renderTree();
        }
      });
      wrap.appendChild(row);

      if (hasChildren) {
        const childWrap = document.createElement('div');
        childWrap.className = 'tree-node__children';
        const inner = document.createElement('div');
        node.children.forEach(child => {
          const childEl = renderNode(child, depth + 1);
          if (childEl) inner.appendChild(childEl);
        });
        childWrap.appendChild(inner);
        wrap.appendChild(childWrap);
      }
      return wrap;
    };

    tree.innerHTML = '';
    state.manifest.children.forEach(child => {
      const el = renderNode(child);
      if (el) tree.appendChild(el);
    });
  };

  // ---------- 渲染列表（递归所有后代 .html） ----------
  const renderList = async (folderPath) => {
    const node = findNode(folderPath);
    const content = $('#content');

    if (!node || node.type !== 'folder') {
      content.innerHTML = `<div class="empty">
        <div class="empty__deco">⌘</div>
        <p>这个目录还是空的。</p>
      </div>`;
      return;
    }

    // 递归收集该文件夹及其所有子文件夹里的 .html
    const articles = [];
    const collect = (n) => {
      if (n.type === 'file') articles.push(n);
      if (n.children) n.children.forEach(collect);
    };
    node.children.forEach(collect);

    // 面包屑
    const displayName = folderPath
      .split('/')
      .map(folderDisplayName)
      .join('  /  ');

    const breadcrumb = folderPath
      .split('/')
      .map(folderDisplayName)
      .map((n, i, arr) =>
        i === arr.length - 1
          ? `<span>${n}</span>`
          : `<span>${n}</span><span class="list-view__breadcrumb-sep">·</span>`
      ).join(' ');

    content.innerHTML = `
      <div class="list-view">
        <header class="list-view__header">
          <div class="list-view__breadcrumb">${breadcrumb}</div>
          <h1 class="list-view__title"><em>${displayName.split(' / ').pop()}</em></h1>
          <p class="list-view__lede">${ledeForFolder(folderPath)}</p>
        </header>
        <div class="list-view__items" id="listItems">
          ${articles.length === 0
            ? `<div class="empty">
                 <div class="empty__deco">✦</div>
                 <p>这里还没有文章。试着在 <code>posts/${folderPath.replace(/^posts\/?/, '')}</code> 里添加一篇吧。</p>
               </div>`
            : articles.map((a, i) => `
                <a class="post-card" href="#/${a.path}" style="animation-delay: ${i * 60}ms">
                  <div class="post-card__body">
                    <div class="post-card__meta">
                      <span>${a.date || '—'}</span>
                      <span class="post-card__meta-dot"></span>
                      <span>${a.readTime || '5 min'}</span>
                    </div>
                    <h2 class="post-card__title">${a.title}</h2>
                    <p class="post-card__summary">${a.summary || ''}</p>
                  </div>
                </a>
              `).join('')
          }
        </div>
      </div>
    `;
  };

  const ledeForFolder = (path) => {
    const map = {
      'posts': '所有笔记的入口——按主题分入不同的小径。',
      'posts/essays': '慢慢写的、不急的长文。',
      'posts/technical': '看代码的笔记、踩过的坑、解开的结。',
      'posts/notes': '短一些的、技术相关或工具相关的零碎。',
      'posts/reading': '正在读、读完想说的书。',
      'posts/fragments': '三言两语——一句话能说清的就不写长。',
      'posts/diary': '私人一些的、不算文章的日记。',
      'posts/diary/2026': '今年。',
      'posts/diary/2025': '去年。',
      'posts/code-snippets': '常用的小段代码，留着下次用。',
      'posts/projects': '做过的小项目，简短记录。',
      'posts/library': '工具、模板、引用——素材抽屉。',
    };
    return map[path] || '这一卷里的笔记。';
  };

  // ---------- 渲染文章 ----------
  const renderArticle = async (articlePath) => {
    const content = $('#content');
    content.innerHTML = `<div class="empty"><div class="empty__deco">·</div><p>正在读……</p></div>`;

    try {
      const res = await fetch(articlePath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const meta = (name) => {
        const el = doc.querySelector(`meta[name="${name}"]`);
        return el ? el.getAttribute('content') : '';
      };

      const title    = meta('title')    || doc.querySelector('h1')?.textContent || titleFromFilename(articlePath.split('/').pop());
      const date     = meta('date')     || '';
      const lede     = meta('lede')     || meta('description') || '';
      const readTime = meta('read-time')|| '';
      const category = meta('category') || '';

      const articleEl = doc.querySelector('article') || doc.body;
      const articleHTML = articleEl.innerHTML;

      content.innerHTML = `
        <div class="article-view">
          <div class="article-shell">
            <button class="back-button" id="backBtn" aria-label="返回">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              <span>返回</span>
            </button>
            <div class="article-headline">
              <div class="article-headline__meta">${category ? category.toUpperCase() : ''} · ${date || '—'}${readTime ? ' · ' + readTime : ''}</div>
              <h1 class="article-headline__title">${title}</h1>
            </div>
            ${lede ? `<p class="article-headline__lede">${lede}</p>` : ''}
            <div class="article-body">${articleHTML}</div>
          </div>
        </div>
      `;

      $('#backBtn').addEventListener('click', () => {
        const parts = articlePath.split('/');
        parts.pop();
        setHash(parts.join('/'));
      });

      // 阅读模式：收起侧栏
      $('#sidebar').classList.add('is-hidden');

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('[article] load failed:', err);
      content.innerHTML = `<div class="error">找不到这篇文章：${articlePath}</div>`;
    }
  };

  // ---------- 顶栏日期 ----------
  const renderDate = () => {
    const d = new Date();
    const opts = { year: 'numeric', month: 'long', day: 'numeric' };
    const txt = d.toLocaleDateString('zh-CN', opts);
    $('#topDate').textContent = txt;
  };

  // ---------- 主渲染 ----------
  const render = async () => {
    const route = parseHash();

    if (route.type === 'folder') {
      state.currentFolder = route.path;
      state.currentArticle = null;
      // 列表视图：显示侧栏
      $('#sidebar').classList.remove('is-hidden');
      await renderList(route.path);
    } else {
      // article: 自动展开所在文件夹
      const parts = route.path.split('/');
      parts.pop();
      const parent = parts.join('/') || 'posts';
      state.currentFolder = parent;
      state.currentArticle = route.path;
      // 展开父级链路上每一层
      const segs = parent.split('/').filter(Boolean);
      let acc = '';
      for (let i = 0; i < segs.length; i++) {
        acc = i === 0 ? segs[i] : (acc + '/' + segs[i]);
        state.openFolders.add(acc);
      }
      await renderArticle(route.path);
    }
    renderTree();
  };

  window.addEventListener('hashchange', render);

  // ---------- 启动 ----------
  (async () => {
    try {
      console.log('[boot] start');
      renderDate();
      console.log('[boot] date rendered');
      await loadManifest();
      console.log('[boot] manifest loaded, children:', state.manifest?.children?.length);
      await render();
      console.log('[boot] render done');
    } catch (err) {
      console.error('[BOOT ERROR]', err.message, err.stack);
    }
  })();
})();
