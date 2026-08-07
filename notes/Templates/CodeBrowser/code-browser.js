(() => {
  'use strict';

  const loader = document.currentScript;
  if (!loader?.hasAttribute('data-code-browser')) return;

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const languageByExtension = {
    c: 'C', cc: 'C++', cpp: 'C++', cxx: 'C++', h: 'C/C++', hh: 'C++', hpp: 'C++',
    cs: 'C#', java: 'Java', js: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript',
    py: 'Python', go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin',
    html: 'HTML', htm: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS', less: 'Less',
    json: 'JSON', uplugin: 'JSON', uproject: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
    md: 'Markdown', markdown: 'Markdown', sql: 'SQL', sh: 'Shell', bash: 'Shell', ps1: 'PowerShell',
    cmake: 'CMake', gradle: 'Gradle', ini: 'INI', conf: 'Config', txt: 'Text'
  };

  const keywordGroups = {
    common: 'as async await break case catch class const continue default delete do else enum export extends false finally for from function if import in instanceof interface let namespace new null of override package private protected public readonly return static struct super switch template this throw true try typedef typeof undefined union using var virtual void volatile while yield'.split(' '),
    cpp: 'alignas alignof asm auto bool char char16_t char32_t concept constexpr const_cast decltype double dynamic_cast explicit extern float friend inline int long mutable noexcept nullptr operator register reinterpret_cast requires short signed sizeof static_assert static_cast thread_local typename unsigned wchar_t'.split(' '),
    python: 'and assert def del elif except False finally global is lambda None nonlocal not or pass raise True with yield'.split(' '),
    rust: 'crate dyn impl macro_rules match mod move mut pub ref self Self trait unsafe use where'.split(' '),
    sql: 'alter begin by column create database distinct drop end group having insert into join key limit on order primary procedure select set table update values view where'.split(' ')
  };
  const keywords = new Set(Object.values(keywordGroups).flat());
  const types = new Set('any bigint boolean byte char decimal double float int integer long never number object short string symbol uint ulong unknown ushort void'.split(' '));
  const controlWords = new Set('if for while switch catch return sizeof alignof'.split(' '));

  const articlePathFromDocument = () => {
    const declared = String(loader.dataset.article || '').trim().replace(/\\/g, '/');
    if (declared) return declared;
    const injected = document.documentElement.dataset.wvdArticlePath;
    if (injected) return injected;
    try {
      const pathname = decodeURIComponent(window.location.pathname);
      if (pathname.startsWith('/content/notes/')) return pathname.slice('/content/'.length);
      if (pathname.startsWith('/notes/')) return pathname.slice(1);
    } catch {}
    return '';
  };

  const start = () => {
    const articlePath = articlePathFromDocument();
    const host = document.createElement('wvd-code-browser');
    host.style.cssText = 'display:block;width:100%;max-width:100%;height:var(--wvd-vh,100vh);min-height:0;margin:0;contain:content;';
    if (loader.parentElement === document.head || !loader.parentElement) document.body.append(host);
    else loader.after(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('code-browser.css', loader.src).href;
    shadow.append(stylesheet);

    const folderIcon = '<svg class="concept-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.25h6l2 2h9v9.5h-17z"/><path d="M3.5 8.25h17"/></svg>';
    const bookmarkIcon = '<svg class="concept-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17l-5.5-3.7-5.5 3.7z"/></svg>';
    const previewIcon = '<svg class="preview-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h10l4 4v13H5z"/><path d="M15 3.5v4h4M8 12h8M8 15h8M8 18h5"/></svg>';
    const root = document.createElement('section');
    root.className = 'browser';
    root.dataset.theme = localStorage.getItem('wvd-code-browser-theme')
      || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    root.innerHTML = `
      <div class="workbench">
        <nav class="activity" aria-label="代码浏览工具">
          <button class="activity-button is-active" data-panel="files" title="文件目录" aria-label="文件目录">${folderIcon}</button>
          <button class="activity-button" data-panel="bookmarks" title="收藏位置" aria-label="收藏位置">${bookmarkIcon}</button>
        </nav>
        <aside class="sidebar">
          <header class="sidebar-heading">
            <span class="sidebar-title">Explorer</span>
          </header>
          <div class="project-name" title=""></div>
          <div class="panel panel-files"><nav class="file-tree" aria-label="文件目录"></nav></div>
          <div class="panel panel-bookmarks" hidden><div class="bookmark-list"></div></div>
        </aside>
        <main class="editor">
          <div class="tabs" role="tablist" aria-label="已打开文件"></div>
          <div class="tools">
            <label class="search-box" title="在当前文件中搜索 (Ctrl+F)">
              <span aria-hidden="true">⌕</span>
              <input class="search-input" type="search" placeholder="搜索当前文件" autocomplete="off">
            </label>
            <span class="search-count">0/0</span>
            <button class="tool-button" data-action="search-prev" title="上一个结果" aria-label="上一个结果">↑</button>
            <button class="tool-button" data-action="search-next" title="下一个结果" aria-label="下一个结果">↓</button>
            <button class="tool-button case-button" data-action="case" title="区分大小写" aria-label="区分大小写">Cc</button>
            <label class="goto-box" title="跳转到行 (Ctrl+G)">:<input class="goto-input" inputmode="numeric" placeholder="行"></label>
            <span class="tools-spacer"></span>
            <button class="tool-button preview-button" data-action="markdown-preview" title="预览 Markdown" aria-label="预览 Markdown" aria-pressed="false" hidden>${previewIcon}</button>
            <button class="tool-button theme-button" data-action="theme" title="切换深浅主题" aria-label="切换深浅主题">◐</button>
          </div>
          <div class="context" hidden><span class="context-icon">ƒ</span><span class="context-name"></span></div>
          <div class="code-area">
            <div class="code-scroll" tabindex="0" aria-label="代码内容"><div class="code-lines"></div></div>
            <canvas class="minimap" aria-label="代码缩略图，拖动可滚动"></canvas>
            <div class="empty-state" role="status"><strong>正在读取代码目录…</strong></div>
          </div>
          <footer class="statusbar">
            <div class="breadcrumbs" title="当前文件路径">—</div>
            <div class="status-right"><span class="cursor-status">1:1</span><span>LF</span><span>UTF-8</span><span class="language-status">Text</span></div>
          </footer>
        </main>
      </div>
      <div class="toast" role="status" aria-live="polite"></div>`;
    shadow.append(root);

    const $ = selector => root.querySelector(selector);
    const $$ = selector => Array.from(root.querySelectorAll(selector));
    const ui = {
      sidebar: $('.sidebar'), tree: $('.file-tree'), project: $('.project-name'), tabs: $('.tabs'),
      lines: $('.code-lines'), scroller: $('.code-scroll'), minimap: $('.minimap'), empty: $('.empty-state'),
      context: $('.context'), contextName: $('.context-name'), search: $('.search-input'),
      searchCount: $('.search-count'), goto: $('.goto-input'), breadcrumbs: $('.breadcrumbs'),
      cursor: $('.cursor-status'), language: $('.language-status'), bookmarks: $('.bookmark-list'),
      preview: $('.preview-button'), toast: $('.toast')
    };
    const state = {
      articlePath, files: [], current: '', open: [], cache: new Map(), lines: [], highlighted: [],
      language: 'Text', functions: [], activeLine: 1, caseSensitive: false, matches: [], matchIndex: -1,
      panel: 'files', markdownPreview: false, paintFrame: 0, toastTimer: 0
    };
    const storageKey = `wvd-code-browser-bookmarks:${articlePath}`;
    const sessionStateKey = `wvd-code-browser-session:${articlePath}`;
    const legacyFileStateKey = `wvd-code-browser-file:${articlePath}`;
    let bookmarks = [];
    try { bookmarks = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch {}
    if (!Array.isArray(bookmarks)) bookmarks = [];

    const showToast = message => {
      ui.toast.textContent = message;
      ui.toast.classList.add('is-visible');
      clearTimeout(state.toastTimer);
      state.toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'), 2200);
    };

    const apiJson = async (endpoint, params) => {
      const url = new URL(endpoint, loader.src);
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    };

    const languageFor = filePath => {
      const name = filePath.split('/').pop() || '';
      const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : name.toLowerCase();
      if (name.toLowerCase() === 'dockerfile') return 'Dockerfile';
      return languageByExtension[extension] || extension.toUpperCase() || 'Text';
    };

    const commentStyle = language => {
      if (['Python', 'Shell', 'PowerShell', 'YAML', 'TOML', 'INI', 'Config'].includes(language)) return { line: '#' };
      if (language === 'SQL') return { line: '--', block: ['/*', '*/'] };
      if (['HTML', 'XML', 'Markdown'].includes(language)) return { block: ['<!--', '-->'] };
      return { line: '//', block: ['/*', '*/'] };
    };

    const highlightPlain = (text, fullLine, baseOffset) => {
      let result = '';
      let cursor = 0;
      const tokenPattern = /\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b|#[A-Za-z_]\w*|\b[A-Za-z_$][\w$]*\b/gi;
      for (const match of text.matchAll(tokenPattern)) {
        result += escapeHtml(text.slice(cursor, match.index));
        const token = match[0];
        const lower = token.toLowerCase();
        let kind = '';
        if (/^(?:0x[\da-f]+|\d)/i.test(token)) kind = 'number';
        else if (token.startsWith('#')) kind = 'preprocessor';
        else if (keywords.has(token) || keywords.has(lower)) kind = 'keyword';
        else if (types.has(lower) || /^[A-Z][A-Za-z0-9_]*$/.test(token)) kind = 'type';
        else if (/^\s*\(/.test(fullLine.slice(baseOffset + match.index + token.length)) && !controlWords.has(lower)) kind = 'function';
        result += kind ? `<span class="tok-${kind}">${escapeHtml(token)}</span>` : escapeHtml(token);
        cursor = match.index + token.length;
      }
      return result + escapeHtml(text.slice(cursor));
    };

    const highlightSource = (lines, language) => {
      const comments = commentStyle(language);
      let inBlockComment = false;
      return lines.map(line => {
        if (/^\s*#\s*(?:include|define|if|ifdef|ifndef|endif|pragma|undef|error|warning)\b/.test(line)) {
          return `<span class="tok-preprocessor">${escapeHtml(line)}</span>`;
        }
        let html = '';
        let index = 0;
        while (index < line.length) {
          if (inBlockComment) {
            const end = line.indexOf(comments.block?.[1] || '', index);
            const stop = end < 0 ? line.length : end + comments.block[1].length;
            html += `<span class="tok-comment">${escapeHtml(line.slice(index, stop))}</span>`;
            index = stop;
            if (end >= 0) inBlockComment = false;
            continue;
          }
          const blockAt = comments.block ? line.indexOf(comments.block[0], index) : -1;
          const lineAt = comments.line ? line.indexOf(comments.line, index) : -1;
          let nextComment = -1;
          if (blockAt >= 0 && lineAt >= 0) nextComment = Math.min(blockAt, lineAt);
          else nextComment = Math.max(blockAt, lineAt);
          const quoteAt = (() => {
            for (let i = index; i < line.length; i += 1) if ('\"\'`'.includes(line[i])) return i;
            return -1;
          })();
          if (nextComment >= 0 && (quoteAt < 0 || nextComment < quoteAt)) {
            html += highlightPlain(line.slice(index, nextComment), line, index);
            if (nextComment === lineAt) {
              html += `<span class="tok-comment">${escapeHtml(line.slice(nextComment))}</span>`;
              break;
            }
            const end = line.indexOf(comments.block[1], nextComment + comments.block[0].length);
            const stop = end < 0 ? line.length : end + comments.block[1].length;
            html += `<span class="tok-comment">${escapeHtml(line.slice(nextComment, stop))}</span>`;
            index = stop;
            inBlockComment = end < 0;
            continue;
          }
          if (quoteAt >= 0) {
            html += highlightPlain(line.slice(index, quoteAt), line, index);
            const quote = line[quoteAt];
            let end = quoteAt + 1;
            while (end < line.length) {
              if (line[end] === quote && line[end - 1] !== '\\') { end += 1; break; }
              end += 1;
            }
            html += `<span class="tok-string">${escapeHtml(line.slice(quoteAt, end))}</span>`;
            index = end;
            continue;
          }
          html += highlightPlain(line.slice(index), line, index);
          break;
        }
        return html || ' ';
      });
    };

    const structuralLines = lines => {
      let inBlock = false;
      return lines.map(line => {
        let clean = '';
        let quote = '';
        for (let i = 0; i < line.length; i += 1) {
          const char = line[i];
          const next = line[i + 1];
          if (inBlock) {
            if (char === '*' && next === '/') { inBlock = false; i += 1; }
            continue;
          }
          if (!quote && char === '/' && next === '*') { inBlock = true; i += 1; continue; }
          if (!quote && char === '/' && next === '/') break;
          if (!quote && '"\'`'.includes(char)) { quote = char; clean += ' '; continue; }
          if (quote) {
            if (char === quote && line[i - 1] !== '\\') quote = '';
            clean += ' ';
            continue;
          }
          clean += char;
        }
        return clean;
      });
    };

    const findFunctions = (lines, language) => {
      if (language === 'Python') {
        const found = [];
        lines.forEach((line, index) => {
          const match = line.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
          if (!match) return;
          const indent = match[1].replace(/\t/g, '    ').length;
          let end = lines.length;
          for (let i = index + 1; i < lines.length; i += 1) {
            if (!lines[i].trim()) continue;
            const nextIndent = (lines[i].match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
            if (nextIndent <= indent) { end = i; break; }
          }
          found.push({ start: index + 1, end, name: line.trim().replace(/:$/, '') });
        });
        return found;
      }

      const clean = structuralLines(lines);
      const found = [];
      clean.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.endsWith(';')) return;
        const named = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$]\w*)\s*\(/)
          || trimmed.match(/^(?:const|let|var)\s+([A-Za-z_$]\w*)\s*=.*=>/)
          || trimmed.match(/(?:^|\s)([A-Za-z_$~][\w$:]*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:override\s*)?(?:->[^{}]+)?\s*\{?\s*$/);
        const name = named?.[1];
        if (!name || controlWords.has(name.toLowerCase())) return;
        let openLine = index;
        while (openLine < Math.min(clean.length, index + 8) && !clean[openLine].includes('{')) {
          if (clean[openLine].includes(';')) return;
          openLine += 1;
        }
        if (openLine >= clean.length || !clean[openLine].includes('{')) return;
        let depth = 0;
        let opened = false;
        let end = clean.length;
        for (let i = openLine; i < clean.length; i += 1) {
          for (const char of clean[i]) {
            if (char === '{') { depth += 1; opened = true; }
            else if (char === '}') depth -= 1;
          }
          if (opened && depth <= 0) { end = i + 1; break; }
        }
        found.push({ start: index + 1, end, name: lines[index].trim().replace(/\s*\{\s*$/, '') });
      });
      return found;
    };

    const fileIcon = filePath => {
      const language = languageFor(filePath);
      if (language === 'C++') return '<span class="file-kind kind-cpp">C+</span>';
      if (language === 'C#') return '<span class="file-kind kind-cs">C#</span>';
      if (language === 'TypeScript') return '<span class="file-kind kind-ts">TS</span>';
      if (language === 'JavaScript') return '<span class="file-kind kind-js">JS</span>';
      if (language === 'JSON') return '<span class="file-kind kind-json">{}</span>';
      return `<span class="file-kind">${escapeHtml((filePath.split('.').pop() || '·').slice(0, 2).toUpperCase())}</span>`;
    };

    const buildTree = files => {
      const rootNode = { directories: new Map(), files: [] };
      files.forEach(file => {
        const parts = file.path.split('/');
        const name = parts.pop();
        let node = rootNode;
        parts.forEach(part => {
          if (!node.directories.has(part)) node.directories.set(part, { directories: new Map(), files: [] });
          node = node.directories.get(part);
        });
        node.files.push({ ...file, name });
      });
      return rootNode;
    };

    const renderTreeNode = node => {
      const folders = [...node.directories.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true }));
      const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      return [
        ...folders.map(([name, child]) => `<details open><summary><span class="chevron">›</span><span class="folder-icon">${folderIcon}</span>${escapeHtml(name)}</summary><div class="tree-level">${renderTreeNode(child)}</div></details>`),
        ...files.map(file => `<button class="file-button${file.path === state.current ? ' is-active' : ''}" data-file="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">${fileIcon(file.path)}<span>${escapeHtml(file.name)}</span></button>`)
      ].join('');
    };

    const renderTree = () => {
      ui.tree.innerHTML = state.files.length ? renderTreeNode(buildTree(state.files)) : '';
    };

    const renderTabs = () => {
      ui.tabs.innerHTML = state.open.map(filePath => `
        <div class="tab${filePath === state.current ? ' is-active' : ''}" role="tab" aria-selected="${filePath === state.current}" title="${escapeHtml(filePath)}">
          <button class="tab-open" data-file="${escapeHtml(filePath)}">${fileIcon(filePath)}<span>${escapeHtml(filePath.split('/').pop())}</span></button>
          <button class="tab-close" data-close="${escapeHtml(filePath)}" aria-label="关闭 ${escapeHtml(filePath)}">×</button>
        </div>`).join('');
      ui.tabs.querySelector('.tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    const saveBookmarks = () => {
      localStorage.setItem(storageKey, JSON.stringify(bookmarks));
      renderBookmarks();
    };
    const saveSession = () => {
      try {
        localStorage.setItem(sessionStateKey, JSON.stringify({ open: state.open, current: state.current }));
        localStorage.removeItem(legacyFileStateKey);
      } catch {}
    };
    const isBookmarked = (file, line) => bookmarks.some(item => item.file === file && item.line === line);
    const toggleBookmark = line => {
      const index = bookmarks.findIndex(item => item.file === state.current && item.line === line);
      if (index >= 0) bookmarks.splice(index, 1);
      else bookmarks.push({ file: state.current, line, created: Date.now() });
      saveBookmarks();
      ui.lines.querySelector(`[data-line="${line}"]`)?.classList.toggle('is-bookmarked', index < 0);
    };
    const renderBookmarks = () => {
      ui.bookmarks.innerHTML = bookmarks.length
        ? [...bookmarks].sort((a, b) => a.created - b.created).map(item => `
          <button class="bookmark-button" data-bookmark-file="${escapeHtml(item.file)}" data-bookmark-line="${item.line}">
            <span class="bookmark-mark">${bookmarkIcon}</span><span><strong>${escapeHtml(item.file.split('/').pop())}:${item.line}</strong><small>${escapeHtml(item.file)}</small></span>
          </button>`).join('')
        : '<p class="panel-hint">点击代码左侧的行号即可收藏位置。</p>';
    };

    const markdownUrl = value => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      if (raw.startsWith('#')) return raw;
      try {
        const fileUrl = state.files.find(file => file.path === state.current)?.url || loader.src;
        const resolved = new URL(raw, new URL(fileUrl, loader.src));
        return ['http:', 'https:', 'mailto:'].includes(resolved.protocol) ? resolved.href : '';
      } catch { return ''; }
    };

    const renderMarkdownInline = value => {
      const tokens = [];
      const keep = html => {
        const marker = `\uE000${tokens.length}\uE001`;
        tokens.push(html);
        return marker;
      };
      let source = String(value || '')
        .replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`))
        .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_, alt, url) => {
          const src = markdownUrl(url);
          return src ? keep(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`) : alt;
        })
        .replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_, label, url) => {
          const href = markdownUrl(url);
          const external = href && !href.startsWith('#');
          return href ? keep(`<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${escapeHtml(label)}</a>`) : label;
        });
      let html = escapeHtml(source)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/(^|[^\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|[^\w])_([^_\n]+)_/g, '$1<em>$2</em>');
      tokens.forEach((token, index) => { html = html.replace(`\uE000${index}\uE001`, token); });
      return html;
    };

    const tableCells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    const isTableDivider = line => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');
    const renderMarkdown = markdown => {
      let lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
      if (lines[0]?.trim() === '---') {
        const end = lines.slice(1).findIndex(line => line.trim() === '---');
        if (end >= 0) lines = lines.slice(end + 2);
      }
      const html = [];
      const headingIds = new Map();
      let paragraph = [];
      const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push(`<p>${renderMarkdownInline(paragraph.join(' '))}</p>`);
        paragraph = [];
      };
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed) { flushParagraph(); continue; }
        const fence = trimmed.match(/^```([\w+-]*)/);
        if (fence) {
          flushParagraph();
          const code = [];
          index += 1;
          while (index < lines.length && !lines[index].trim().startsWith('```')) code.push(lines[index++]);
          html.push(`<pre><code class="language-${escapeHtml(fence[1])}">${escapeHtml(code.join('\n'))}</code></pre>`);
          continue;
        }
        const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          flushParagraph();
          const baseId = heading[2].toLowerCase().replace(/`([^`]*)`/g, '$1').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
          const count = headingIds.get(baseId) || 0;
          headingIds.set(baseId, count + 1);
          const id = count ? `${baseId}-${count}` : baseId;
          html.push(`<h${heading[1].length} id="${escapeHtml(id)}">${renderMarkdownInline(heading[2])}</h${heading[1].length}>`);
          continue;
        }
        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushParagraph(); html.push('<hr>'); continue; }
        if (trimmed.startsWith('>')) {
          flushParagraph();
          const quoted = [];
          while (index < lines.length && lines[index].trim().startsWith('>')) quoted.push(lines[index++].trim().replace(/^>\s?/, ''));
          index -= 1;
          html.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
          continue;
        }
        if (trimmed.includes('|') && isTableDivider(lines[index + 1])) {
          flushParagraph();
          const headings = tableCells(line);
          const rows = [];
          index += 2;
          while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(tableCells(lines[index++]));
          index -= 1;
          html.push(`<div class="markdown-table"><table><thead><tr>${headings.map(cell => `<th>${renderMarkdownInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${renderMarkdownInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
          continue;
        }
        const list = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (list) {
          flushParagraph();
          const ordered = Boolean(list[2]);
          const items = [];
          while (index < lines.length) {
            const item = lines[index].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
            if (!item || Boolean(item[2]) !== ordered) break;
            const task = item[3].match(/^\[([ xX])\]\s*(.*)$/);
            items.push(task
              ? `<li class="task-item"><input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}>${renderMarkdownInline(task[2])}</li>`
              : `<li>${renderMarkdownInline(item[3])}</li>`);
            index += 1;
          }
          index -= 1;
          html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
          continue;
        }
        paragraph.push(trimmed);
      }
      flushParagraph();
      return html.join('\n');
    };

    const renderCode = () => {
      const canPreview = state.language === 'Markdown';
      if (!canPreview) state.markdownPreview = false;
      ui.preview.hidden = !canPreview;
      ui.preview.classList.toggle('is-active', state.markdownPreview);
      ui.preview.setAttribute('aria-pressed', String(state.markdownPreview));
      const previewLabel = state.markdownPreview ? '显示 Markdown 源码' : '预览 Markdown';
      ui.preview.title = previewLabel;
      ui.preview.setAttribute('aria-label', previewLabel);
      ui.lines.classList.toggle('is-markdown-preview', state.markdownPreview);
      root.classList.toggle('markdown-preview-active', state.markdownPreview);
      if (state.markdownPreview) {
        ui.lines.innerHTML = `<article class="markdown-preview">${renderMarkdown(state.lines.join('\n'))}</article>`;
      } else {
        ui.lines.innerHTML = state.highlighted.map((line, index) => {
          const lineNumber = index + 1;
          return `<div class="code-line${isBookmarked(state.current, lineNumber) ? ' is-bookmarked' : ''}" data-line="${lineNumber}"><button class="line-number" data-bookmark="${lineNumber}" title="收藏第 ${lineNumber} 行">${lineNumber}</button><code>${line}</code></div>`;
        }).join('');
      }
      ui.empty.hidden = true;
      ui.minimap.hidden = state.markdownPreview;
      ui.search.disabled = state.markdownPreview;
      ui.goto.disabled = state.markdownPreview;
      requestAnimationFrame(() => {
        paintMinimap();
        if (state.markdownPreview) ui.context.hidden = true;
        else updateContext();
        try { window.parent.dispatchEvent(new Event('resize')); } catch {}
      });
    };

    const lineHeight = () => ui.lines.querySelector('.code-line')?.getBoundingClientRect().height || 21;
    const scrollToLine = (line, center = true) => {
      const safeLine = Math.max(1, Math.min(state.lines.length || 1, Number(line) || 1));
      state.activeLine = safeLine;
      ui.cursor.textContent = `${safeLine}:1`;
      $$('.code-line.is-current').forEach(element => element.classList.remove('is-current'));
      ui.lines.querySelector(`[data-line="${safeLine}"]`)?.classList.add('is-current');
      ui.scroller.scrollTo({ top: Math.max(0, (safeLine - 1) * lineHeight() - (center ? ui.scroller.clientHeight * 0.35 : 0)), behavior: 'smooth' });
    };

    const updateSearchMarks = () => {
      $$('.code-line.has-match, .code-line.is-match-current').forEach(element => element.classList.remove('has-match', 'is-match-current'));
      const active = state.matches[state.matchIndex];
      state.matches.forEach(match => ui.lines.querySelector(`[data-line="${match.line}"]`)?.classList.add('has-match'));
      if (active) ui.lines.querySelector(`[data-line="${active.line}"]`)?.classList.add('is-match-current');
      ui.searchCount.textContent = state.matches.length ? `${state.matchIndex + 1}/${state.matches.length}` : '0/0';
    };

    const performSearch = reset => {
      const query = ui.search.value;
      state.matches = [];
      if (query) {
        const needle = state.caseSensitive ? query : query.toLowerCase();
        state.lines.forEach((line, lineIndex) => {
          const haystack = state.caseSensitive ? line : line.toLowerCase();
          let startAt = 0;
          while (startAt <= haystack.length) {
            const column = haystack.indexOf(needle, startAt);
            if (column < 0) break;
            state.matches.push({ line: lineIndex + 1, column: column + 1 });
            startAt = column + Math.max(1, needle.length);
          }
        });
      }
      state.matchIndex = state.matches.length ? (reset ? 0 : Math.min(state.matchIndex, state.matches.length - 1)) : -1;
      updateSearchMarks();
      if (reset && state.matches.length) scrollToLine(state.matches[0].line);
    };

    const jumpSearch = direction => {
      if (!state.matches.length) return;
      state.matchIndex = (state.matchIndex + direction + state.matches.length) % state.matches.length;
      updateSearchMarks();
      scrollToLine(state.matches[state.matchIndex].line);
    };

    const updateContext = () => {
      const visibleLine = Math.max(1, Math.floor(ui.scroller.scrollTop / lineHeight()) + 1);
      const currentFunction = state.functions.find(item => visibleLine >= item.start && visibleLine <= item.end);
      ui.context.hidden = !currentFunction;
      ui.contextName.textContent = currentFunction?.name || '';
    };

    const minimapMetrics = height => {
      const rowStep = 2;
      const contentHeight = state.lines.length * rowStep;
      const maxScroll = Math.max(0, ui.scroller.scrollHeight - ui.scroller.clientHeight);
      const sliderHeight = Math.min(height, Math.max(1, Math.floor(ui.scroller.clientHeight / lineHeight() * rowStep)));
      const sliderTravel = Math.max(0, Math.min(height - sliderHeight, contentHeight - sliderHeight));
      const scrollRatio = maxScroll ? ui.scroller.scrollTop / maxScroll : 0;
      return { rowStep, contentHeight, maxScroll, sliderHeight, sliderTravel, scrollRatio };
    };

    const paintMinimap = () => {
      state.paintFrame = 0;
      if (!state.lines.length || ui.minimap.hidden) return;
      const rect = ui.minimap.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (ui.minimap.width !== width || ui.minimap.height !== height) {
        ui.minimap.width = width;
        ui.minimap.height = height;
      }
      const context = ui.minimap.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      const metrics = minimapMetrics(rect.height);
      const { rowStep, contentHeight, maxScroll, sliderHeight, sliderTravel, scrollRatio } = metrics;
      const rowHeight = 1.2;
      const minimapScroll = scrollRatio * Math.max(0, contentHeight - rect.height);
      const firstLine = Math.max(0, Math.floor(minimapScroll / rowStep) - 1);
      const lastLine = Math.min(state.lines.length, Math.ceil((minimapScroll + rect.height) / rowStep) + 1);
      for (let index = firstLine; index < lastLine; index += 1) {
        const line = state.lines[index];
        const trimmed = line.trim();
        if (!trimmed) continue;
        const indent = Math.min(24, line.length - line.trimStart().length) * 1.4;
        const lineY = index * rowStep - minimapScroll;
        context.fillStyle = /^\s*(?:\/\/|#|--)/.test(line) ? '#6a9955' : /["'`]/.test(line) ? '#ce9178' : '#6c94c8';
        context.globalAlpha = 0.72;
        context.fillRect(5 + indent, lineY, Math.min(rect.width - 9 - indent, Math.max(3, trimmed.length * 0.55)), rowHeight);
      }
      context.globalAlpha = 1;
      if (maxScroll > 0 && sliderTravel > 0) {
        const sliderTop = scrollRatio * sliderTravel;
        context.fillStyle = 'rgba(130, 150, 175, .16)';
        context.strokeStyle = 'rgba(130, 150, 175, .48)';
        context.fillRect(0, sliderTop, rect.width, sliderHeight);
        context.strokeRect(.5, sliderTop + .5, rect.width - 1, Math.max(1, sliderHeight - 1));
      }
    };

    const scheduleMinimap = () => {
      if (!state.paintFrame) state.paintFrame = requestAnimationFrame(paintMinimap);
    };

    const updatePath = () => {
      const parts = state.current ? [ui.project.textContent, ...state.current.split('/')].filter(Boolean) : [];
      ui.breadcrumbs.innerHTML = parts.length
        ? parts.map(part => `<span>${escapeHtml(part)}</span>`).join('<i>›</i>')
        : '—';
      ui.language.textContent = state.language;
    };

    const openFile = async (filePath, line = 1) => {
      if (!state.files.some(file => file.path === filePath)) return;
      state.current = filePath;
      state.markdownPreview = false;
      if (!state.open.includes(filePath)) state.open.push(filePath);
      renderTabs();
      renderTree();
      ui.empty.hidden = false;
      ui.empty.innerHTML = '<strong>正在打开文件…</strong>';
      ui.minimap.hidden = true;
      try {
        let content = state.cache.get(filePath);
        if (content === undefined) {
          const file = state.files.find(item => item.path === filePath);
          if (!file?.url) throw new Error('CODE_FILE_NOT_FOUND');
          if (file.size > 2 * 1024 * 1024) throw new Error('CODE_FILE_TOO_LARGE');
          const response = await fetch(new URL(file.url, loader.src), { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          if (bytes.includes(0)) throw new Error('BINARY_CODE_FILE');
          content = new TextDecoder().decode(bytes);
          state.cache.set(filePath, content);
        }
        if (state.current !== filePath) return;
        state.lines = String(content).replace(/\r\n?/g, '\n').split('\n');
        state.language = languageFor(filePath);
        state.highlighted = highlightSource(state.lines, state.language);
        state.functions = findFunctions(state.lines, state.language);
        saveSession();
        state.activeLine = Math.max(1, Number(line) || 1);
        state.matches = [];
        state.matchIndex = -1;
        renderCode();
        renderBookmarks();
        updatePath();
        performSearch(false);
        ui.scroller.scrollTop = Math.max(0, (state.activeLine - 1) * lineHeight());
        scrollToLine(state.activeLine, false);
      } catch (error) {
        ui.lines.innerHTML = '';
        ui.empty.hidden = false;
        ui.empty.innerHTML = `<strong>无法预览此文件</strong><span>${escapeHtml(error.message)}</span>`;
        showToast('文件可能是二进制文件或超过 2 MB');
      }
    };

    const closeFile = filePath => {
      const index = state.open.indexOf(filePath);
      if (index < 0) return;
      state.open.splice(index, 1);
      if (state.current === filePath) {
        const next = state.open[Math.min(index, state.open.length - 1)];
        if (next) openFile(next);
        else {
          state.current = '';
          state.lines = [];
          ui.lines.innerHTML = '';
          ui.minimap.hidden = true;
          ui.empty.hidden = false;
          ui.empty.innerHTML = '<strong>从左侧目录选择一个文件</strong>';
          updatePath();
        }
      }
      saveSession();
      renderTabs();
      renderTree();
    };

    const setPanel = panel => {
      const isOpen = !root.classList.contains('sidebar-collapsed');
      if (isOpen && state.panel === panel) {
        root.classList.add('sidebar-collapsed');
        $$('.activity-button[data-panel]').forEach(button => button.classList.remove('is-active'));
        return;
      }
      state.panel = panel;
      root.classList.remove('sidebar-collapsed');
      $$('.activity-button[data-panel]').forEach(button => button.classList.toggle('is-active', button.dataset.panel === panel));
      $('.panel-files').hidden = panel !== 'files';
      $('.panel-bookmarks').hidden = panel !== 'bookmarks';
    };

    const loadProject = async () => {
      ui.empty.hidden = false;
      ui.empty.innerHTML = '<strong>正在读取代码目录…</strong>';
      try {
        if (!state.articlePath) throw new Error('无法确定当前 HTML 的文章路径');
        const data = await apiJson('/api/code-browser', { article: state.articlePath });
        state.files = data.files || [];
        ui.project.textContent = data.directoryName;
        ui.project.title = data.directoryName;
        renderTree();
        renderBookmarks();
        if (!data.exists) {
          ui.empty.innerHTML = `<strong>未找到对应代码目录</strong><span>请在 HTML 同级创建“${escapeHtml(data.directoryName)}”文件夹。</span>`;
          return;
        }
        if (!state.files.length) {
          ui.empty.innerHTML = `<strong>代码目录为空</strong><span>${escapeHtml(data.directoryName)}</span>`;
          return;
        }
        if (data.truncated) showToast('文件超过 3000 个，仅显示前 3000 个');
        let savedSession = null;
        let legacyFile = '';
        try {
          savedSession = JSON.parse(localStorage.getItem(sessionStateKey) || 'null');
          legacyFile = localStorage.getItem(legacyFileStateKey) || '';
        } catch {}
        const available = new Set(state.files.map(file => file.path));
        const savedOpen = Array.isArray(savedSession?.open) ? savedSession.open.filter(file => available.has(file)) : [];
        const savedCurrent = available.has(savedSession?.current) ? savedSession.current : '';
        state.open = [...new Set(savedOpen)];
        const initialFile = savedCurrent || (available.has(legacyFile) ? legacyFile : state.open[0]) || state.files[0].path;
        if (!state.open.includes(initialFile)) state.open.push(initialFile);
        renderTabs();
        await openFile(initialFile);
      } catch (error) {
        ui.empty.innerHTML = `<strong>代码浏览器加载失败</strong><span>${escapeHtml(error.message)}</span>`;
      }
    };

    root.addEventListener('click', event => {
      const target = event.target.closest('button, summary, canvas, a');
      if (!target) return;
      if (target.matches('a[href^="#"]')) {
        const heading = ui.lines.querySelector(`#${CSS.escape(decodeURIComponent(target.getAttribute('href').slice(1)))}`);
        if (heading) {
          event.preventDefault();
          ui.scroller.scrollTo({ top: heading.offsetTop - 18, behavior: 'smooth' });
        }
      } else if (target.dataset.file) openFile(target.dataset.file);
      else if (target.dataset.close) closeFile(target.dataset.close);
      else if (target.dataset.bookmark) toggleBookmark(Number(target.dataset.bookmark));
      else if (target.dataset.bookmarkFile) {
        openFile(target.dataset.bookmarkFile, Number(target.dataset.bookmarkLine));
      } else if (target.dataset.panel) setPanel(target.dataset.panel);
      else if (target.dataset.action === 'search-prev') jumpSearch(-1);
      else if (target.dataset.action === 'search-next') jumpSearch(1);
      else if (target.dataset.action === 'case') {
        state.caseSensitive = !state.caseSensitive;
        target.classList.toggle('is-active', state.caseSensitive);
        performSearch(true);
      } else if (target.dataset.action === 'markdown-preview') {
        state.markdownPreview = !state.markdownPreview;
        ui.scroller.scrollTop = 0;
        renderCode();
      } else if (target.dataset.action === 'theme') {
        root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('wvd-code-browser-theme', root.dataset.theme);
        scheduleMinimap();
      }
    });

    ui.search.addEventListener('input', () => performSearch(true));
    ui.search.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); jumpSearch(event.shiftKey ? -1 : 1); }
      if (event.key === 'Escape') { ui.search.value = ''; performSearch(true); ui.scroller.focus(); }
    });
    ui.goto.addEventListener('keydown', event => {
      if (event.key === 'Enter') { scrollToLine(ui.goto.value); ui.goto.select(); }
    });
    ui.scroller.addEventListener('scroll', () => { updateContext(); scheduleMinimap(); }, { passive: true });
    ui.scroller.addEventListener('wheel', event => event.stopPropagation(), { passive: true });

    let minimapDragging = false;
    const scrollFromMinimap = event => {
      const rect = ui.minimap.getBoundingClientRect();
      const { maxScroll, sliderHeight, sliderTravel } = minimapMetrics(rect.height);
      const sliderTop = Math.max(0, Math.min(sliderTravel, event.clientY - rect.top - sliderHeight / 2));
      ui.scroller.scrollTop = sliderTravel ? sliderTop / sliderTravel * maxScroll : 0;
    };
    ui.minimap.addEventListener('pointerdown', event => {
      minimapDragging = true;
      ui.minimap.classList.add('is-dragging');
      ui.minimap.setPointerCapture(event.pointerId);
      scrollFromMinimap(event);
      event.preventDefault();
      event.stopPropagation();
    });
    ui.minimap.addEventListener('pointermove', event => {
      if (!minimapDragging) return;
      scrollFromMinimap(event);
      event.preventDefault();
      event.stopPropagation();
    });
    const stopMinimapDrag = event => {
      if (!minimapDragging) return;
      minimapDragging = false;
      ui.minimap.classList.remove('is-dragging');
      if (ui.minimap.hasPointerCapture(event.pointerId)) ui.minimap.releasePointerCapture(event.pointerId);
    };
    ui.minimap.addEventListener('pointerup', stopMinimapDrag);
    ui.minimap.addEventListener('pointercancel', stopMinimapDrag);
    ui.minimap.addEventListener('wheel', event => {
      const unit = event.deltaMode === 1 ? lineHeight() : event.deltaMode === 2 ? ui.scroller.clientHeight : 1;
      ui.scroller.scrollTop += event.deltaY * unit;
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false });
    root.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault(); ui.search.focus(); ui.search.select();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault(); ui.goto.focus(); ui.goto.select();
      }
    });
    new ResizeObserver(scheduleMinimap).observe(ui.scroller);
    renderBookmarks();
    loadProject();
  };

  if (loader.parentElement === document.head && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else start();
})();
