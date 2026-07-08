# WoBok's Vibe Daily 重构设计文档

文档状态：Current v3  
日期：2026-07-08  
依据：[devdocs/requirement.md](requirement.md)、[devdocs/deployment.md](deployment.md)、当前项目代码

## 1. 当前状态与目标

这篇文档最初记录的是从静态原型重建为个人笔记站的方案。当前网站已经完成了大部分重构，并且有若干实现细节与初版方案不同。本文档以当前代码为准，记录现状、约束和后续演进方向。

当前项目是一个轻量的个人笔记主页：

- `index.html` 提供站点壳、顶部栏、移动端 Index 按钮、文章页 Back 按钮、左右 rail 入口。
- `app.js` 使用 hash 路由，调用 Node API，渲染目录树、Latest、叶子目录列表、Markdown 文章和 HTML 文章。
- `style.css` 维护 Botanical Organic Serif 风格、列表页、文章页、rail、移动端抽屉和图片灯箱样式。
- `server/` 是 Node.js 原生 HTTP 服务，不依赖 Express。
- `scripts/build-content.js` 用于手动清理无效内容并重建 manifest。
- `notes/` 是当前内容根目录，替代早期方案中的 `posts/`。

重构后的核心目标仍然是：

1. 内容以文件夹分类，以 `.md` / `.markdown` / `.html` 文件作为文章。
2. 只识别 `0x` 开头的分类目录。
3. 只有叶子目录中的文章进入 manifest；非叶子目录中的文章文件会被忽略。
4. 首页右侧显示 `Latest`，按时间展示全站有效文章。
5. 点击叶子目录只显示该目录直接包含的文章。
6. Node 服务启动时扫描内容，运行时监听文件变化并重建 manifest。
7. Markdown 在前端渲染；HTML 文章保留原页面语义和样式，并通过 iframe 呈现。
8. 文章页提供左侧大纲 rail 和右侧引用 rail。
9. 生产部署采用 Nginx 反向代理到 Node 服务。

## 2. 已落地的关键决策

1. 内容根目录已经从 `posts/` 改为 `notes/`。
2. API、manifest、内容 URL 都使用 `notes/` 路径体系。
3. Node 服务入口为 `server/index.js`，默认监听 `127.0.0.1:55555`。
4. 当前后端使用 Node 内置 `http`、`fs`、`fs.watch`，没有外部 npm 依赖。
5. manifest 构建集中在 Node 后端，前端不直接读取 `notes/**/_manifest.json`。
6. `npm run build:content` 会执行带清理的内容构建，删除无效 `0x` 目录外内容。
7. `npm run start` 和 `npm run dev` 都会启动 Node 服务；默认开启文件监听，除非设置 `WATCH=0`。
8. `/api/tree`、`/api/latest`、`/api/folder`、`/api/article` 已实现。
9. `/api/rebuild` 已实现为手动重建入口。
10. `/content/notes/*` 由 Node 服务提供，支持文章和文章相对资源文件。
11. HTML 文章 API 返回内容 URL；前端优先 fetch HTML，改写相对资源后用 iframe `srcdoc` 呈现，失败时回退到 iframe `src`。
12. Markdown 目前使用项目内置的轻量解析器，不使用 `markdown-it`、`marked`、`highlight.js` 或 KaTeX。
13. LaTeX 公式使用 MathJax CDN 按需加载。
14. Markdown 图片支持相对路径改写、加载状态和点击灯箱。
15. 文章列表会缓存渲染结果并保存滚动位置，Back 返回时恢复到原列表位置。
16. 移动端隐藏常驻 sidebar / rail，使用 `Index`、`Outline`、`Refs` 按钮打开抽屉。

## 3. 总体架构

当前架构是“Node 一体服务 + Nginx 反向代理”。

```text
Browser
  |
  | static: /, /index.html, /style.css, /app.js
  | api: /api/*
  | content: /content/notes/*
  v
Nginx
  |
  | reverse proxy
  v
Node.js server: 127.0.0.1:55555
  |
  | scan / read / watch / manifest cache / static serving
  v
notes/
  |_ _manifest.json
  |_ 0x0 - Inbox/
  |   |_ _manifest.json
  |   |_ 鲜与灰.html
  |   |_ 最长的一日.html
  |_ 0x1 - Concepts/
      |_ 0x0 - Math/
          |_ 0x0 - Linear Algebra/
              |_ _manifest.json
              |_ 点积.md
```

### 3.1 后端职责

Node 后端负责：

- 确保 `notes/` 内容根存在。
- 扫描有效 `0x` 分类目录。
- 判断叶子目录。
- 从 Markdown frontmatter 和 HTML meta 中提取 metadata。
- 写入根 `_manifest.json` 和叶子目录 `_manifest.json`。
- 保存 manifest 内存缓存。
- 提供目录树、Latest、叶子目录列表和文章内容 API。
- 提供 `/content/notes/*` 内容资源访问。
- 提供根目录静态文件访问。
- 做路径安全校验、私有文件拦截和缓存控制。
- 监听内容目录变化并 debounce 后重建 manifest。

### 3.2 前端职责

前端负责：

- hash 路由和页面状态。
- 目录树展开、折叠、选中和移动端 Index 抽屉。
- Latest 和叶子目录文章列表渲染。
- 列表渲染缓存和滚动位置恢复。
- Markdown 解析、资源路径改写、MathJax 渲染、图片灯箱。
- HTML fetch、资源路径改写、`srcdoc` 注入、iframe 自适应高度。
- Markdown / HTML 大纲提取。
- Markdown / HTML 外部引用提取和正文标记。
- 左右 rail 的 hover 展开、点击跳转和移动端 drawer。

### 3.3 部署职责

生产环境推荐：

- Node 服务只监听 `127.0.0.1:55555`。
- Nginx 对外提供 HTTP / HTTPS。
- Nginx 将站点所有请求反向代理到 Node。

当前部署文档采用反向代理一体服务方式，不再要求 Nginx 单独映射静态文件或 `/content/notes/`。

## 4. 内容组织规范

### 4.1 内容根目录

当前内容根目录固定为：

```text
notes/
```

早期文档和需求中出现的 `posts/` 已经被 `notes/` 替代。后续新增文档、脚本和部署配置时应统一使用 `notes/`。

### 4.2 分类目录规则

有效分类目录必须以 `0x` 开头。

当前校验规则大致等价于：

```text
0x[hex-number]
0x[hex-number] - Name
0x[hex-number] Name
```

示例：

```text
notes/
  0x0 - Inbox/
    凝视画布.html
  0x1 - Concepts/
    0x0 - Math/
      0x0 - Linear Algebra/
        点积.md
```

前端 Index 中会保留完整目录名，也就是保留 `0x* - ` 前缀。列表页标题和路径面包屑会使用 display name，去掉 `0x* - ` 前缀。

### 4.3 叶子目录规则

只有叶子目录中的文章会被扫描和展示。

- 叶子目录：没有有效 `0x` 子分类目录的目录。
- 非叶子目录：包含有效 `0x` 子分类目录，只负责展开/收起。
- 非叶子目录中的 `.md` / `.markdown` / `.html` 会被忽略。
- 空叶子目录会显示在目录树中，但不会进入文章列表。

当前点击空叶子目录时，不会切换右侧内容；如果它所在层级有其他展开分支，可能会触发同级分支收起和目录树重绘。

### 4.4 文章文件格式

支持的文章格式：

- `.md`
- `.markdown`
- `.html`

其他文件不会作为文章进入 manifest，但可以作为文章资源通过 `/content/notes/*` 被访问，例如图片、CSS、脚本等。当前 `pathGuard` 要求资源路径中的每一级目录也满足 `0x` 分类规则，因此文章资源建议直接放在文章所在叶子目录中。`images/`、`assets/` 这类非 `0x` 子目录当前会被拒绝，并且在 `npm run build:content` 时会被清理。

### 4.5 清理规则

`npm run build:content` 会调用 `scripts/build-content.js`，以 `cleanup: true` 运行扫描。

当前清理行为：

- 确保 `notes/` 存在。
- 删除 `notes/` 根目录下非 `_manifest.json` 的散落文件。
- 删除任意层级中不符合 `0x` 命名规则的目录及其内容。
- 不会删除有效分类目录内的非文章资源文件。

服务启动时默认 `cleanup: false`，不会自动删除内容。

## 5. metadata 规范

### 5.1 Markdown metadata

Markdown 推荐使用 frontmatter：

```md
---
title: 点积
date: 2026-07-08
summary: 从几何投影与代数运算两个角度理解点积。
tags:
  - math
---

# 点积
```

当前后端解析优先级：

1. `title`：frontmatter.title -> 第一个 `# h1` -> 文件名。
2. `date`：frontmatter.date -> 文件名中的 `YYYY-MM-DD` -> 文件创建时间。
3. `summary`：frontmatter.summary -> 空字符串。
4. `categoryName`：frontmatter.category -> 叶子目录 display name。

注意：

- `summary` 仍然表示“文章总结”，由作者主动填写。
- 当前 frontmatter parser 是轻量实现，适合简单 key-value 和列表，不等价于完整 YAML parser。
- 前端渲染 Markdown 时会移除 frontmatter，但 metadata 以服务端提取结果为准。

### 5.2 HTML metadata

HTML 推荐使用 meta：

```html
<meta name="title" content="鲜与灰">
<meta name="summary" content="一篇关于色彩和感受的笔记。">
<meta name="date" content="2026-07-08">
<meta name="category" content="Inbox">
```

当前后端解析优先级：

1. `title`：`meta[name=title]` -> `<title>` -> 第一个 `<h1>` -> 文件名。
2. `date`：`meta[name=date]` -> 文件名中的 `YYYY-MM-DD` -> 文件创建时间。
3. `summary`：`meta[name=summary]` -> `meta[name=description]` -> 空字符串。
4. `categoryName`：`meta[name=category]` -> 叶子目录 display name。

HTML meta 的 `content` 值中如果包含双引号，需要写成 `&quot;`，否则浏览器和后端正则解析都可能截断属性值。

## 6. manifest 设计

### 6.1 文件位置

当前仍使用物理 `_manifest.json`：

```text
notes/_manifest.json
notes/0x0 - Inbox/_manifest.json
notes/0x1 - Concepts/0x0 - Math/0x0 - Linear Algebra/_manifest.json
```

后端扫描和文件监听会忽略 `_manifest.json`、`_manifest.json.*.tmp` 和隐藏文件，避免写 manifest 时触发循环重建。

### 6.2 marker 设计

manifest 使用标准 JSON。

```json
{
  "version": 1,
  "type": "leaf",
  "folderName": "0x0 - Inbox",
  "folderPath": "notes/0x0 - Inbox",
  "displayName": "Inbox",
  "marker": {
    "articleCount": 4,
    "signature": "sha1:...",
    "generatedAt": "2026-07-08T00:00:00.000Z"
  },
  "articles": []
}
```

当前 signature 输入包含：

- `article.path`
- `article.format`
- `article.title`
- `article.date`
- `article.summary`
- `article.mtimeMs`
- `article.size`

这样可以覆盖文章数量不变但标题、日期、总结、mtime 或文件大小变化的情况。

如果新生成的 signature 和 articleCount 与旧 manifest 一致，后端会保留旧的 `generatedAt`，避免无意义变更。

### 6.3 叶子 manifest

叶子 manifest 示例：

```json
{
  "version": 1,
  "type": "leaf",
  "folderName": "0x0 - Inbox",
  "folderPath": "notes/0x0 - Inbox",
  "displayName": "Inbox",
  "marker": {
    "articleCount": 1,
    "signature": "sha1:...",
    "generatedAt": "2026-07-08T00:00:00.000Z"
  },
  "articles": [
    {
      "id": "notes/0x0 - Inbox/凝视画布.html",
      "path": "notes/0x0 - Inbox/凝视画布.html",
      "name": "凝视画布.html",
      "format": "html",
      "title": "凝视画布",
      "date": "2026-07-08",
      "summary": "文章总结。",
      "categoryPath": "notes/0x0 - Inbox",
      "categoryName": "Inbox",
      "mtimeMs": 1783331520000,
      "size": 12345
    }
  ]
}
```

### 6.4 根 manifest

根 manifest 示例：

```json
{
  "version": 1,
  "type": "root",
  "rootPath": "notes",
  "marker": {
    "articleCount": 42,
    "signature": "sha1:...",
    "generatedAt": "2026-07-08T00:00:00.000Z"
  },
  "tree": [
    {
      "name": "0x0 - Inbox",
      "path": "notes/0x0 - Inbox",
      "displayName": "Inbox",
      "type": "folder",
      "isLeaf": true,
      "articleCount": 4,
      "children": []
    }
  ],
  "latest": []
}
```

`latest` 是全站有效文章扁平列表，排序规则为：

1. `date desc`
2. 同一天按 `mtimeMs desc`

`tree[*].articleCount` 对叶子目录表示直接文章数，对非叶子目录表示后代文章总数。

### 6.5 manifest 写入

当前写入策略：

- JSON 使用两个空格缩进，文件末尾保留换行。
- 写入前比较旧内容，内容相同则不写。
- 内容不同则先写临时文件，再 rename 到目标文件。
- Windows 上 rename 遇到 `EPERM`、`EACCES`、`EBUSY` 时会短暂重试。

## 7. Node 后端设计

### 7.1 当前目录结构

```text
server/
  index.js
  config.js
  services/
    articleMetaService.js
    contentScanner.js
    manifestService.js
    watchService.js
  utils/
    pathGuard.js
    pathTools.js
    stableHash.js
scripts/
  build-content.js
```

当前实现保留了简单的一体式 `server/index.js`，没有拆出独立 routes 文件。后续只有当 API 数量继续增加时，才需要把路由拆分出去。

### 7.2 package scripts

```json
{
  "scripts": {
    "build:content": "node scripts/build-content.js",
    "start": "node server/index.js",
    "dev": "node server/index.js --watch"
  },
  "engines": {
    "node": ">=22"
  }
}
```

当前项目没有外部 npm 依赖。

### 7.3 API 设计

#### GET `/api/tree`

返回目录树和全站文章数。

```json
{
  "tree": [],
  "totalArticles": 42
}
```

#### GET `/api/latest`

返回全站按时间排序的有效文章列表。

查询参数：

- `limit`：可选，`0` 或省略表示返回全部。
- `offset`：可选，默认 `0`。

响应：

```json
{
  "articles": [],
  "totalArticles": 42
}
```

#### GET `/api/folder?path=notes%2F0x0%20-%20Inbox`

只允许叶子目录。

若目录不存在：

```json
{
  "error": "FOLDER_NOT_FOUND"
}
```

若不是叶子目录：

```json
{
  "error": "NOT_LEAF_FOLDER"
}
```

若是叶子目录：

```json
{
  "folder": {},
  "articles": []
}
```

#### GET `/api/article?path=notes%2F0x0%20-%20Inbox%2Fnote.md`

Markdown 返回原文：

```json
{
  "article": {
    "path": "notes/0x0 - Inbox/note.md",
    "format": "markdown",
    "title": "Note",
    "date": "2026-07-08",
    "summary": "文章总结。",
    "categoryPath": "notes/0x0 - Inbox",
    "mtimeMs": 1783331520000
  },
  "content": {
    "markdown": "---\ntitle: Note\n---\n\n# Note\n"
  }
}
```

HTML 返回内容 URL：

```json
{
  "article": {
    "path": "notes/0x0 - Inbox/page.html",
    "format": "html",
    "title": "Page",
    "date": "2026-07-08",
    "summary": "文章总结。",
    "categoryPath": "notes/0x0 - Inbox",
    "mtimeMs": 1783331520000
  },
  "content": {
    "url": "/content/notes/0x0%20-%20Inbox/page.html?v=1783331520000"
  }
}
```

`v=mtimeMs` 用于降低浏览器继续使用旧 HTML 内容的概率。

#### POST `/api/rebuild`

手动重建 manifest，当前不执行清理。

```json
{
  "totalArticles": 42,
  "generatedAt": "2026-07-08T00:00:00.000Z"
}
```

### 7.4 内容文件服务

`/content/notes/*` 由 Node 服务读取 `notes/` 下文件并返回。

当前行为：

- path 会 decode、normalize，并要求以 `notes/` 开头。
- 路径必须仍在 `NOTES_DIR` 内。
- 目录部分必须全部是有效 `0x` 分类目录。
- 拒绝 `_manifest.json`、隐藏文件和路径穿越。
- 支持 `ETag`、`Last-Modified`、`If-None-Match`。
- 默认 `Cache-Control: no-cache`。

该服务不仅用于 HTML 文章，也用于 Markdown / HTML 中的相对图片、CSS、脚本等资源。

### 7.5 静态文件服务

Node 当前只允许直接访问以下根文件：

- `/`
- `/index.html`
- `/app.js`
- `/style.css`
- `/favicon.ico`

其他普通路径会回退到 `/index.html`，方便 SPA hash 路由和刷新。

### 7.6 路径安全

所有 API 和内容文件路径都经过 `pathGuard`。

校验要点：

- decode 后必须以 `notes/` 开头。
- normalize 后不能是 `..` 或以 `../` 开头。
- resolve 后必须仍在 `NOTES_DIR` 内。
- 分类目录必须满足 `0x` 命名规则。
- 文章 API 只允许 `.md`、`.markdown`、`.html`。
- 内容服务拒绝 `_manifest.json` 和隐藏文件。

常见错误码：

- `PATH_TRAVERSAL`
- `PATH_OUTSIDE_NOTES`
- `INVALID_CONTENT_PATH`
- `INVALID_CATEGORY_PATH`
- `PRIVATE_CONTENT`
- `UNSUPPORTED_ARTICLE_TYPE`
- `CONTENT_NOT_FOUND`

### 7.7 文件监听策略

当前没有使用 `chokidar`，而是使用 Node 原生 `fs.watch`。

扫描时会收集 watch dirs：

- `notes/`
- 每一个有效 `0x` 分类目录。

监听行为：

- 每个目录单独 `fs.watch`，非递归。
- 忽略 `_manifest.json`、`_manifest.json.*.tmp`、`.hidden`、临时 `.tmp` 文件。
- 任意未忽略事件都会 debounce 500ms 后触发一次全量 `manifestService.rebuild({ cleanup: false })`。
- 重建后刷新 watcher 列表，以便新增目录被纳入监听。

当前实现选择了“事件触发后全量扫描并写 manifest”的简单策略，而不是按变更路径增量更新单个叶子 manifest。以个人笔记站规模看，这个实现更稳、更容易维护。

注意：

- 线上服务默认开启监听，除非设置 `WATCH=0`。
- 若部署在特殊文件系统、网络盘或容器挂载目录上，`fs.watch` 行为可能不稳定；必要时再评估是否引入 `chokidar`。

## 8. 浏览器缓存同步

当前缓存策略：

- `/api/*` 返回 `Cache-Control: no-store`。
- `/content/notes/*` 返回 `Cache-Control: no-cache`，并带 `ETag` / `Last-Modified`。
- HTML 文章 URL 带 `?v=mtimeMs`。
- 前端 fetch API 和 HTML 内容时使用 `cache: 'no-store'`。
- `index.html`、`app.js`、`style.css` 由 Node 以 `no-cache` 返回。
- `index.html` 中当前通过 `style.css?v=20260707-rail-refine` 和 `app.js?v=20260707-rail-refine` 做了一层手动版本参数。

后续如果引入构建工具，可以改为带 hash 的静态资源文件名，减少手工改版本参数。

## 9. Markdown 前端渲染

### 9.1 当前实现

Markdown 仍然在前端渲染，但当前不是第三方 Markdown 引擎，而是 `app.js` 中的轻量解析器。

当前支持：

- frontmatter 移除。
- 标题 `#` 到 `######`。
- 段落。
- 无序列表。
- 有序列表。
- blockquote。
- 水平线。
- fenced code block。
- inline code。
- 粗体和斜体的基础写法。
- Markdown 图片。
- Markdown 链接。
- 行内公式 `$...$`。
- 块级公式 `$$...$$` 和部分多行公式形式。

当前不支持或不完整支持：

- Markdown table。
- 复杂嵌套列表。
- footnote 语法。
- 完整 CommonMark 兼容。
- 代码语法高亮。

后续如果笔记格式复杂度继续上升，可以再引入 `markdown-it` / `marked`、`DOMPurify` 和代码高亮库。

### 9.2 资源路径改写

Markdown 中的相对链接和图片会按文章所在目录解析，并改写到 `/content/notes/*`。当前资源文件应直接放在文章所在叶子目录中，除非后续放宽 `pathGuard` 对资源子目录的限制。

支持示例：

```md
![图](./figure.png)
[同目录资源](asset.pdf)
[notes 绝对路径](notes/0x0 - Inbox/figure.png)
```

外部链接、协议链接、`#anchor` 会保留原样。

### 9.3 LaTeX

当前使用 MathJax：

```text
https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js
```

前端会先检测文章内容是否包含公式特征，只有需要时才加载 MathJax。MathJax 配置支持：

- 行内公式：`$...$`、`\(...\)`
- 块级公式：`$$...$$`、`\[...\]`
- TeX environments

### 9.4 Markdown 页面结构

Markdown 文章页结构：

```text
NOTES · 分类路径 · 日期
文章标题
Markdown 正文
```

正文使用 `.markdown-body`，保持站点统一字体和纸面风格。

### 9.5 图片灯箱

Markdown 图片当前会：

- 使用相对路径改写后的 URL。
- 设置 lazy loading。
- 加载成功后标记 `is-loaded`。
- 加载失败后标记 `is-error`。
- 支持点击打开灯箱。
- 支持键盘 Enter / Space 打开灯箱。

## 10. HTML 文章加载

### 10.1 当前策略

HTML 文章 API 返回 `/content/notes/...html?v=mtimeMs`。前端加载时：

1. 创建一个 `iframe.html-article-frame`，设置 `scrolling="no"`。
2. 通过 fetch 请求 HTML 内容。
3. 使用 `DOMParser` 解析 HTML。
4. 改写 HTML 内部相对资源路径。
5. 改写 CSS 中的 `url(...)`。
6. 将 CSS 中的 `vh` 换算为 `var(--wvd-vh)`，降低 iframe 嵌套视口差异。
7. 将处理后的完整 HTML 写入 iframe `srcdoc`。
8. 如果 fetch 或 `srcdoc` 流程失败，则回退为 `iframe.src = url`。

文章正文区域不额外显示站点目录路径、时间或标题，避免和原 HTML 的标题、导航重复。

### 10.2 HTML 资源改写

当前会改写这些元素的资源属性：

- `img[src]`
- `script[src]`
- `link[href]`
- `source[src]`
- `video[src]`
- `audio[src]`
- `iframe[src]`
- `embed[src]`
- `object[data]`
- `a[href]`
- `img[srcset]`
- `source[srcset]`

也会改写：

- 行内 `style` 属性中的 `url(...)`
- `<style>` 标签中的 `url(...)`
- CSS 中的 `vh` 单位

### 10.3 HTML 滚动与锚点跳转

当前 iframe 内部滚动被关闭，外层页面承担滚动。

实现要点：

- iframe 高度会按内部内容高度动态调整。
- iframe 文档 `html` 和 `body` 设置 `overflow: hidden`。
- iframe 内 wheel 事件会转发为父页面滚动。
- iframe 内同页锚点链接会被拦截，并滚动父页面到对应 iframe 内元素位置。
- outline 点击 HTML heading 时，也会滚动父页面到 iframe 内对应元素。

这样可以让站点顶部栏、左右 rail 和 HTML 内容共享一个外层滚动体验。

### 10.4 HTML 轻量引用增强

HTML 保真优先。当前仅对外部链接做轻量增强：

- 提取 `http` / `https` 外部链接。
- 排除 `#anchor`、`mailto:`、`tel:`。
- 排除图片链接。
- 给链接设置 `data-wvd-ref`。
- 注入小段样式，在链接左上角显示序号，并保留下划线。
- 右侧 Refs rail 显示相同序号和链接文本。

## 11. 文章大纲与引用 rail

### 11.1 页面结构

文章页结构：

```text
topbar
  brand                         Back

article-view
  outline rail | article-stage | refs rail
```

桌面端 rail 使用 `position: fixed`，固定在视口左右两侧。移动端 rail 变成从左右滑出的 drawer。

### 11.2 大纲提取

Markdown：

- Markdown 渲染完成后，从 `.markdown-body` 提取 `h1-h6`。
- 没有 id 的 heading 会生成 `heading-${index}-${slug}`。
- 点击 outline 项滚动到对应 heading。

HTML：

- iframe load 后，从 iframe `document.body` 提取 `h1-h6`。
- 没有 id 的 heading 会补 id。
- 点击 outline 项滚动外层页面到 iframe 内对应 heading。

### 11.3 引用提取

Markdown：

- 从渲染后的正文 DOM 中提取外部链接。
- 给正文链接追加 `<sup class="ref-mark">n</sup>`。
- 右侧 Refs rail 点击后新标签页打开链接。

HTML：

- 从 iframe DOM 中提取外部链接。
- 使用 `data-wvd-ref` 和注入 CSS 添加序号。
- 右侧 Refs rail 点击后新标签页打开链接。

引用数据结构：

```json
{
  "index": 1,
  "text": "显示文本",
  "href": "https://example.com",
  "element": {}
}
```

### 11.4 rail 交互现状

当前已实现：

- 收起态以短线显示。
- hover 后展开文字。
- outline 左侧显示不同 heading 层级的不同线长和文字尺寸。
- refs 右侧展开并右对齐。
- 鼠标移出有短暂 fading 过渡。
- 点击 refs 项后收起 refs rail。
- 空 rail 显示 `No headings` / `No refs`。
- 移动端使用底部 `Outline` / `Refs` 按钮打开抽屉。

当前未实现：

- 早期方案中的 Mac Dock 式 pointermove 距离缩放。
- active heading 高亮。
- HTML iframe 内滚动的 active outline 监听。

## 12. 前端路由与状态

### 12.1 Hash 路由

当前路由：

```text
#/                                          Latest
#/folder/notes%2F0x0%20-%20Inbox
#/article/notes%2F0x0%20-%20Inbox%2Fnote.md
#/article/notes%2F0x0%20-%20Inbox%2Fpage.html
```

路由类型显式区分 `latest`、`folder`、`article`，不再靠文件扩展名猜页面类型。

### 12.2 顶栏

当前顶栏：

- 左侧品牌：`WoBok's Vibe Daily`。
- 右侧 tagline：默认显示 `Just trying to grasp things easily with AI.`，hover 打字动画切换为 `Simplicity is the ultimate sophistication.`。
- 移动端显示 `Index` 按钮。
- 文章页显示 `Back` 按钮，并隐藏 tagline。

`Back` 行为：

- 优先回到打开文章前的文件夹列表。
- 如果来源是 Latest，则回到 Latest。
- 返回列表时恢复之前的滚动位置。

### 12.3 目录树

当前目录树行为：

- 启动时通过 `/api/tree` 加载。
- Index 中保留完整 `0x* - Name` 目录名。
- 左侧 dot 使用文本 `·`，不是 SVG 或传统箭头。
- 有子目录的节点点击展开/收起。
- 展开某个分支时会收起同级其他分支。
- 点击有文章的叶子目录进入 folder 路由。
- 点击当前已打开叶子目录不会重复请求。
- 点击空叶子目录不会切换内容。
- 品牌点击会关闭所有目录并回到 Latest。

目录计数显示后代文章总数。

### 12.4 列表页

Latest：

- 标题为 `Latest`。
- eyebrow 为 `HOME`。
- 展示 `/api/latest` 返回的全站有效文章。

叶子目录：

- 标题为叶子目录 display name。
- eyebrow 为 display path。
- 展示 `/api/folder` 返回的该叶子目录直接文章。

列表卡片字段：

- 日期。
- 分类名。
- 标题。
- 文章总结。

当前已经移除阅读时间。

### 12.5 列表缓存与滚动恢复

当前前端维护：

- `listCacheByRoute`
- `listScrollByRoute`
- `lastListRoute`

效果：

- 从列表进入文章前保存当前滚动位置。
- Back 返回列表时先渲染缓存内容，随后请求最新 API 数据。
- 如果列表内容未变化，不重复替换 DOM。
- 返回后恢复到之前的滚动位置。

## 13. 样式方向

当前视觉仍是 Botanical Organic Serif：

- 主体背景：象牙白纸面、轻微纹理和低透明渐变。
- 字体：`Fraunces`、`Newsreader`、`DM Mono`。
- 主色：森林绿、苔藓绿、鼠尾草绿、陶土色、Morandi red。
- 顶栏 sticky，半透明 blur。
- 列表卡片为温和纸面感，hover 轻微上浮。
- 文章页 Markdown 宽度约 720px，外层约 880px。
- HTML 文章 iframe 全宽显示，背景白色。
- rail 是细线型浮动目录标尺。
- 移动端 sidebar 和 rail 都以 fixed drawer 形式出现。

当前有一点和早期方案不同：目录 dot 和路径分隔符实际使用 Morandi red，而不是纯墨绿色 / 浅绿色体系。

## 14. nginx 与部署

### 14.1 推荐部署方式

当前推荐方式见 [devdocs/deployment.md](deployment.md)：

```text
Browser
  -> Nginx: 80/443
  -> Node.js: 127.0.0.1:55555
  -> /home/admin/WoboksVibeDaily
  -> notes/
```

Node 负责静态文件、API 和内容文件服务。Nginx 只做反向代理、HTTPS、访问日志和对外入口。

### 14.2 Node 服务

默认：

```text
HOST=127.0.0.1
PORT=55555
```

本地或服务器启动：

```bash
npm run start
```

开发启动：

```bash
npm run dev
```

重建内容：

```bash
npm run build:content
```

### 14.3 Nginx 示例

```nginx
server {
    listen 80;
    server_name example.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:55555;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

早期方案中 Nginx 单独 `alias /content/posts/` 的方式已经不是当前推荐路径。

### 14.4 更新流程

常规更新：

```bash
cd /home/admin/WoboksVibeDaily
git pull
npm install
npm run build:content
sudo systemctl restart woboks-vibe-daily
sudo systemctl reload nginx
```

如果只是修改 `notes/` 内容，运行中的 Node 服务通常会通过 watcher 自动刷新 manifest。线上稳妥起见，仍建议发布后执行一次 `npm run build:content` 并重启服务。

## 15. 潜在问题与后续建议

### 15.1 `fs.watch` 的平台差异

当前原生 `fs.watch` 足够轻量，但不同平台和文件系统事件语义不同。若后续部署环境出现漏事件、重复事件或网络盘问题，再考虑引入 `chokidar`。

### 15.2 当前是全量重建，不是增量重建

文件变化后当前会全量扫描 `notes/` 并重建相关 manifest。个人站点规模下这是可接受的，也减少了移动、删除、重命名造成的边界错误。若文章规模明显增大，再设计增量队列。

### 15.3 Markdown parser 不是完整 Markdown 引擎

当前轻量解析器适合简单笔记，但不支持表格、复杂嵌套和完整 CommonMark。若笔记格式继续变复杂，建议替换为成熟 Markdown 引擎，并配套 DOMPurify。

### 15.4 代码高亮尚未实现

当前 fenced code block 会保留 `language-*` class，但没有加载高亮库。后续可以接入 `highlight.js` 或 `shiki`。

### 15.5 HTML `srcdoc` 保真与脚本行为

`srcdoc` 让资源改写和统一滚动更可控，但复杂 HTML 页面里的相对导航、脚本生命周期、跨 frame 逻辑可能出现兼容问题。当前有 iframe `src` fallback，后续需要按具体 HTML 页面修复。

### 15.6 active outline 尚未实现

当前 outline 支持点击跳转，但不会随滚动高亮当前 heading。Markdown 可以先用 `IntersectionObserver` 实现；HTML 需要结合 iframe 内元素位置和外层滚动计算。

### 15.7 XSS 与内容信任边界

当前站点是个人笔记站，默认内容可信。Markdown 渲染路径会 escape 大部分原始 HTML，但 HTML 文章会保留原脚本执行能力。若以后支持外部投稿或不可信内容，必须加入 sandbox、CSP 和清理策略。

### 15.8 手动版本参数

当前 `index.html` 使用手动 query 版本号加载 `style.css` 和 `app.js`。后续如引入构建流程，应改为自动 hash 文件名。

## 16. 已完成与待办

### 已完成

1. Node 后端基础服务。
2. `notes/` 内容根迁移。
3. `0x` 分类目录扫描。
4. 叶子目录文章规则。
5. Markdown / HTML metadata 提取。
6. 根 manifest 和叶子 manifest 生成。
7. `/api/tree`、`/api/latest`、`/api/folder`、`/api/article`。
8. `/api/rebuild`。
9. 文件监听和 debounce 重建。
10. Latest 默认页。
11. 叶子目录列表页。
12. Back 和列表滚动恢复。
13. Markdown 前端渲染。
14. MathJax 按需加载。
15. Markdown 图片灯箱。
16. HTML `srcdoc` 加载和资源改写。
17. HTML iframe 高度自适应和外层滚动。
18. Markdown / HTML 大纲 rail。
19. Markdown / HTML 引用 rail。
20. 移动端 Index / Outline / Refs 抽屉。
21. Nginx 反向代理部署文档。

### 待办

1. 引入成熟 Markdown 引擎或补全表格等语法。
2. 增加代码高亮。
3. 实现 active outline。
4. 评估是否引入 DOMPurify。
5. 评估 `fs.watch` 在线上环境的稳定性。
6. 为后端路径校验、metadata 提取、scanner、API 增加自动化测试。
7. 为前端列表、文章页、rail 和移动端抽屉增加浏览器回归测试。
8. 将静态资源 query 版本号改为自动化策略。

## 17. 测试方案

### 17.1 后端测试

- `pathGuard` 阻止 `../`。
- `pathGuard` 拒绝非 `notes/` 路径。
- `pathGuard` 拒绝 `_manifest.json` 和隐藏文件。
- scanner 只识别 `0x` 分类目录。
- scanner 正确识别叶子目录。
- 非叶子目录文章不进入 manifest。
- Markdown frontmatter 优先级正确。
- HTML meta / title / h1 fallback 正确。
- marker signature 能识别 metadata、mtime、size 变化。
- `build:content` 会删除无效目录和根散落文件。
- watcher 忽略 manifest 写入事件。
- watcher 在新增目录后刷新 watch dirs。

### 17.2 API 测试

- `/api/tree` 返回目录树与总数。
- `/api/latest` 排序正确。
- `/api/latest?limit=&offset=` 分页切片正确。
- `/api/folder` 拒绝非叶子目录。
- `/api/folder` 对空叶子返回空数组。
- `/api/article` 对 Markdown 返回原文。
- `/api/article` 对 HTML 返回带版本参数的内容 URL。
- `/api/rebuild` 能触发重建。
- `/content/notes/*` 能返回文章所在叶子目录中的相对资源。
- `/content/notes/*` 拒绝 manifest 和路径穿越。

### 17.3 浏览器验证

- 首页显示 `Latest`。
- Index 中目录保留 `0x` 前缀。
- 目录展开/收起和同级收起正确。
- 空叶子目录不切换右侧内容。
- 叶子目录列表只显示直接文章。
- 列表项显示日期、分类、标题、总结。
- 从列表进入文章后 Back 恢复原滚动位置。
- Markdown 标题、列表、引用、代码块、图片、公式正常。
- Markdown 图片灯箱可点击和键盘打开。
- HTML 页面样式、脚本和相对资源正常。
- HTML 页面滚动与外层页面一致。
- HTML 内部锚点跳转不刷新 iframe。
- 左侧 Outline rail 可展开和点击跳转。
- 右侧 Refs rail 可展开并打开外部链接。
- 移动端 Index / Outline / Refs 抽屉不遮挡主要流程。

## 18. 当前 MVP 结论

当前 MVP 已经从“方案设计”进入“可运行实现”阶段。站点的事实架构是：

1. `notes/` 是唯一内容根。
2. manifest 由 Node 生成并缓存，物理文件仍写入 `notes/**/_manifest.json`。
3. 前端只通过 API 和 `/content/notes/*` 访问内容。
4. Markdown 由前端轻量解析器渲染，MathJax 按需处理公式。
5. HTML 文章优先通过 fetch + `srcdoc` 呈现，保留原页面并补充资源改写、统一滚动、大纲和引用。
6. 部署推荐 Nginx 反向代理到 Node 一体服务。

这套实现已经满足“文件即发布、自动更新索引、个人知识站可持续维护”的核心目标。后续优化重点应放在 Markdown 完整度、代码高亮、active outline、自动化测试和生产环境 watcher 稳定性上。
