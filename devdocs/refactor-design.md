# WoBok's Vibe Daily 重构设计文档

文档状态：Draft v2  
日期：2026-07-06  
依据：[devdocs/requirement.md](requirement.md)、当前项目代码、2026-07-06 13:32 需求确认

## 1. 背景与目标

当前项目是个人笔记主页的前期设计原型：

- `index.html` 提供站点壳、顶部栏、左侧目录和右侧内容容器。
- `app.js` 使用 hash 路由，读取静态 `manifest.json`，渲染目录树、文章列表和文章页面。
- `style.css` 已建立 Botanical Organic Serif 风格的基础视觉。
- `posts/` 下目前以 `.html` 测试文章为主，包含简单文章型 HTML 和完整页面型 HTML。

本次重构目标是把原型升级为一个可持续发布的个人笔记主页：

1. 内容以文件夹为分类，以 `.md` / `.markdown` / `.html` 文件为文章。
2. 只有叶子目录可以存放并展示文章；非叶子目录里的文章文件直接忽略。
3. 只识别 `0x` 开头的分类目录，非 `0x` 开头的测试目录和散落文件后续清理。
4. 首页左侧为目录树，右侧默认显示 `Latest`，按时间展示全站笔记。
5. 点击叶子目录时，只显示该叶子目录直接包含的文章。
6. 使用 Node.js 后端监听文件系统变化并自动构建 manifest。
7. Markdown 在前端渲染；HTML 使用 iframe 原样加载。
8. 文章页左右两侧增加 Overlay：左侧文章大纲，右侧文章引用。
9. 使用 nginx 托管静态资源并反向代理 Node API。

## 2. 已确认的关键决策

1. manifest 构建完全迁移到 Node.js 后端和文件监听系统。
2. 非叶子目录中的 `.md` / `.markdown` / `.html` 文件不扫描、不展示、不提示。
3. 前端现阶段继续保留在项目根目录，不需要迁移到 `client/` 或 `src/`。
4. 文件监听不是持续遍历目录，而是启动时扫描一次，之后响应系统文件事件。
5. `/api/tree` 只返回目录树和全站文章数。
6. 删除、移动文件或文件夹需要触发 manifest 更新。
7. 需要处理服务器文件变化后浏览器缓存不同步的问题。
8. Markdown、文章大纲、引用提取主要放在前端处理。
9. HTML 文章保持 iframe 原样加载，只做轻量链接脚注增强。
10. 空叶子目录点击无反应，鼠标按下时可短暂变色，松开还原。
11. 目录选中路径高亮主要体现在目录左侧小圆点，不大改当前目录行样式。
12. 列表中的 `summary` 中文统一理解为“文章总结”，不是普通自动摘要。
13. HTML 文章页内容区只保留 iframe 原 HTML，不额外显示目录路径、时间和文章标题。
14. 可以使用现代 CSS 能力，目标主流浏览器为 Chrome、Edge、Safari。
15. 移动端默认隐藏左右 rail，改为边缘按钮或顶部按钮打开大纲/引用面板。

## 3. 总体架构

推荐采用“nginx + Node API + 静态前端”的轻量架构。

```text
Browser
  |
  | static: index.html / style.css / app.js
  | api: /api/*
  v
nginx
  |--------------------> static files
  |--------------------> /content/posts/* -> posts/*
  |
  v
Node.js server
  |
  | scan / read / watch / manifest cache
  v
posts/
  |_ _manifest.json
  |_ 0x0 - Inbox/
  |   |_ _manifest.json
  |   |_ note.md
  |   |_ page.html
  |_ 0x1 - Concepts/
      |_ 0x0 - Math/
          |_ _manifest.json
          |_ limit.md
```

### 3.1 职责划分

Node 后端负责：

- 扫描 `posts/` 中有效的 `0x` 分类目录。
- 判断叶子目录。
- 构建根 manifest 和叶子 manifest。
- 监听文章和目录变化。
- 提供目录树、Latest、叶子目录文章列表和文章原始内容 API。
- 做路径安全校验和缓存控制。

前端负责：

- 路由和页面状态。
- 目录树交互。
- 文章列表渲染。
- Markdown 解析、LaTeX、代码高亮。
- Markdown / HTML 的大纲提取和引用提取。
- 文章页左右 Overlay 交互。
- HTML iframe 内轻量链接脚注增强。

nginx 负责：

- 静态资源服务。
- `/api/*` 反向代理到 Node。
- `/content/posts/*` 映射到文章文件。
- 禁止直接访问 `_manifest.json`。

### 3.2 前端目录位置

现阶段前端继续保留在项目根目录：

```text
index.html
app.js
style.css
server/
posts/
devdocs/
```

只有后续引入 Vite、React、TypeScript 或复杂构建流程时，才需要考虑迁移到 `client/` 或 `src/`。本次重构不需要为此做额外改动。

## 4. 内容组织规范

### 4.1 分类目录规则

内容根目录固定为 `posts/`。

有效分类目录必须以 `0x` 开头：

```text
posts/
  0x0 - Inbox/
    note.md
    page.html
  0x1 - Concepts/
    0x0 - Math/
      limit.md
    0x1 - Art/
```

建议所有分类层级都使用 `0x* - Name` 格式。构建时只扫描有效分类目录；非 `0x` 开头的目录直接忽略。

### 4.2 叶子目录规则

只有叶子目录可以展示文章。

- 叶子目录：没有子分类目录的目录。
- 非叶子目录：包含子分类目录的目录，只负责展开/收起。
- 非叶子目录中如果出现 `.md` / `.markdown` / `.html`，直接忽略。
- 空叶子目录：目录树可显示，但点击不切换右侧内容。

### 4.3 文章文件格式

支持：

- `.md`
- `.markdown`
- `.html`

HTML 可以是完整页面。完整 HTML 会通过 iframe 加载，保留原样式、脚本、标题、导航和布局。

### 4.4 测试内容清理

当前 `posts/` 中非 `0x` 开头的目录和文件均视为测试内容。后续正式构建时可删除这些测试目录和散落文件，只保留 `0x` 分类目录及其中测试文章。

删除属于实际文件操作，需要在执行实现或清理阶段单独确认。

## 5. metadata 规范

### 5.1 Markdown metadata

Markdown 推荐使用 frontmatter：

```md
---
title: 用一条主线看懂微积分
date: 2026-07-06
summary: 从函数、极限、导数、微分和积分之间的关系建立直觉。
tags:
  - math
---

# 用一条主线看懂微积分
```

字段优先级：

1. `title`：frontmatter.title -> 第一个 `# h1` -> 文件名。
2. `date`：frontmatter.date -> 文件名日期 -> 文件创建时间。
3. `summary`：frontmatter.summary -> 空字符串。
4. `category`：frontmatter.category -> 叶子目录名。

`summary` 是文章总结，应该由作者主动填写。自动截取正文只能作为后续可选兜底，不作为主要设计。

### 5.2 HTML metadata

HTML 推荐使用 meta：

```html
<meta name="title" content="UE Render Order Notes">
<meta name="summary" content="关于 UE 渲染顺序的私人笔记。">
<meta name="date" content="2026-06-18">
<meta name="category" content="Technical">
```

字段优先级：

1. `meta[name=title]` -> `<title>` -> 第一个 `<h1>` -> 文件名。
2. `meta[name=date]` -> 文件名日期 -> 文件创建时间。
3. `meta[name=summary]` -> `meta[name=description]` -> 空字符串。
4. `meta[name=category]` -> 叶子目录名。

`read-time` 不进入列表 UI，可以不再生成。若旧文章存在该字段，前端忽略。

### 5.3 metadata 注意事项

HTML meta 的 `content` 值中如果包含双引号，需要正确转义为 `&quot;`，否则浏览器解析会截断属性值。

## 6. manifest 设计

### 6.1 文件位置

使用 `_manifest.json`：

```text
posts/_manifest.json
posts/0x0 - Inbox/_manifest.json
posts/0x1 - Concepts/0x0 - Math/_manifest.json
```

后端扫描和文件监听必须忽略所有 `_manifest.json`，避免写入 manifest 时触发循环重建。

### 6.2 marker 设计

manifest 使用标准 JSON，不使用“第一行特殊标记”。

```json
{
  "version": 1,
  "folderPath": "posts/0x0 - Inbox",
  "marker": {
    "articleCount": 4,
    "signature": "sha1:...",
    "generatedAt": "2026-07-06T13:32:00+09:00"
  },
  "articles": []
}
```

`articleCount` 只能判断数量变化。为了识别“文件数量没变，但标题、总结、日期或内容变化”的情况，需要加入 `signature`。

推荐签名规则：

```text
sha1(relativePath + size + mtimeMs + fileType)
```

### 6.3 叶子 manifest

```json
{
  "version": 1,
  "type": "leaf",
  "folderName": "0x0 - Inbox",
  "folderPath": "posts/0x0 - Inbox",
  "displayName": "Inbox",
  "marker": {
    "articleCount": 4,
    "signature": "sha1:...",
    "generatedAt": "2026-07-06T13:32:00+09:00"
  },
  "articles": [
    {
      "id": "posts/0x0 - Inbox/note.md",
      "path": "posts/0x0 - Inbox/note.md",
      "format": "markdown",
      "title": "Note",
      "date": "2026-07-06",
      "summary": "文章总结。",
      "categoryPath": "posts/0x0 - Inbox",
      "categoryName": "Inbox",
      "mtimeMs": 1783331520000
    }
  ]
}
```

### 6.4 根 manifest

```json
{
  "version": 1,
  "type": "root",
  "rootPath": "posts",
  "marker": {
    "articleCount": 42,
    "signature": "sha1:...",
    "generatedAt": "2026-07-06T13:32:00+09:00"
  },
  "tree": [
    {
      "name": "0x0 - Inbox",
      "path": "posts/0x0 - Inbox",
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

`latest` 存全站有效文章扁平列表，按 `date desc` 排序；同一天文章再按 `mtimeMs desc` 排序。

### 6.5 前端是否直接读 manifest

前端不直接读取 `posts/**/_manifest.json`。前端只调用 Node API。

好处：

- manifest 文件位置未来可调整。
- 后端可以统一做路径安全、缓存校验和状态更新。
- nginx 可以禁止外部直接访问 `_manifest.json`。

## 7. Node 后端设计

### 7.1 推荐目录结构

```text
server/
  index.js
  config.js
  routes/
    manifestRoutes.js
    articleRoutes.js
  services/
    contentScanner.js
    manifestService.js
    articleMetaService.js
    watchService.js
  utils/
    pathGuard.js
    stableHash.js
```

Node 后端不负责 Markdown 正文渲染、大纲提取和引用提取。

### 7.2 API 设计

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

- `limit`：可选，默认返回全部。
- `offset`：可选，未来分页使用。

#### GET `/api/folder?path=posts%2F0x0%20-%20Inbox`

只允许叶子目录。返回该叶子目录的直接文章列表。

若不是叶子目录：

```json
{
  "error": "NOT_LEAF_FOLDER"
}
```

若是空叶子目录：

```json
{
  "folder": {},
  "articles": []
}
```

#### GET `/api/article?path=posts%2F0x0%20-%20Inbox%2Fnote.md`

Markdown 返回原文：

```json
{
  "article": {
    "path": "posts/0x0 - Inbox/note.md",
    "format": "markdown",
    "title": "Note",
    "date": "2026-07-06",
    "summary": "文章总结。",
    "categoryPath": "posts/0x0 - Inbox",
    "mtimeMs": 1783331520000
  },
  "content": {
    "markdown": "---\\ntitle: Note\\n---\\n\\n# Note\\n"
  }
}
```

HTML 返回 iframe 地址：

```json
{
  "article": {
    "path": "posts/0x0 - Inbox/page.html",
    "format": "html",
    "title": "Page",
    "date": "2026-07-06",
    "summary": "文章总结。",
    "categoryPath": "posts/0x0 - Inbox",
    "mtimeMs": 1783331520000
  },
  "content": {
    "url": "/content/posts/0x0%20-%20Inbox/page.html?v=1783331520000"
  }
}
```

`v=mtimeMs` 用于避免服务器文件变化后浏览器继续使用旧 iframe 内容。

### 7.3 路径安全

所有 API 接收的 path 必须经过校验：

- decode 后必须以 `posts/` 开头。
- normalize 后必须仍在内容根目录内。
- 禁止 `..` 路径穿越。
- 只允许读取 `.md`、`.markdown`、`.html`。
- 忽略 `_manifest.json`。
- 只接受位于有效 `0x` 分类路径下的文章。

### 7.4 文件监听策略

使用 `chokidar` 监听有效内容路径：

```text
posts/0x*/**/*.md
posts/0x*/**/*.markdown
posts/0x*/**/*.html
```

忽略：

```text
posts/**/_manifest.json
posts/**/.*
```

事件策略：

- `add`：重建新增文件所属叶子 manifest，更新根 manifest。
- `change`：重建变更文件所属叶子 manifest，更新根 manifest。
- `unlink`：重建删除文件原所属叶子 manifest，更新根 manifest。
- `addDir`：重建目录树，必要时重建相关叶子 manifest 和根 manifest。
- `unlinkDir`：重建目录树和根 manifest。
- 移动文件通常表现为 `unlink + add`，需要同时影响旧目录和新目录。
- 移动文件夹通常表现为 `unlinkDir + addDir`，需要重建目录树和根 manifest。

性能策略：

- 启动时扫描一次，建立内存缓存。
- 启动后依赖文件系统事件，不持续遍历文件夹。
- 对同一叶子目录 debounce 300-800ms。
- 使用单队列串行写 manifest，避免并发写同一文件。
- 使用 `awaitWriteFinish` 避免编辑器保存时读到半写入文件。
- 文件频繁变化时只写最后一次结果。

### 7.5 manifest 更新流程

启动流程：

1. 扫描 `posts/` 下有效 `0x` 分类目录。
2. 建立目录树。
3. 找出叶子目录。
4. 校验每个叶子 `_manifest.json` 的 marker。
5. 失效则重建叶子 manifest。
6. 聚合所有叶子 manifest 生成根 `_manifest.json`。
7. 建立内存缓存。
8. 开始监听文件变化。

API 请求流程：

1. 优先读内存缓存。
2. 若缓存缺失，读取 `_manifest.json`。
3. 若 marker 失效，触发同步重建当前叶子或根。
4. 返回结果。

文件监听触发后：

1. 找到变更文件所在或原所在叶子目录。
2. 重建对应叶子 manifest。
3. 根据变化更新根 latest 与目录计数。
4. 写入根 `_manifest.json`。
5. 更新内存缓存。

## 8. 浏览器缓存同步

需要考虑服务器文件发生变化，但当前浏览器仍使用旧缓存的情况。

推荐策略：

- `/api/*` 返回 `Cache-Control: no-store` 或 `no-cache`。
- `/content/posts/*` 使用 `ETag` / `Last-Modified`。
- HTML iframe URL 追加 `?v=mtimeMs`。
- Markdown 文章由 `/api/article` 返回原文，API 不缓存或短缓存。
- 页面重新获得焦点时，可轻量重新请求 `/api/latest` 或当前文章 metadata。
- 实时推送不是 MVP 必需；后续可考虑 SSE 或 WebSocket 通知前端刷新。

## 9. Markdown 前端渲染方案

### 9.1 渲染位置

Markdown 在前端渲染。Node 只返回 Markdown 原文和 metadata。

理由：

- 个人笔记站内容量通常不大，现代用户设备渲染 Markdown 压力很低。
- 可以减少服务器 CPU 消耗。
- 前端渲染后可直接从 DOM 提取大纲和引用，链路更简单。
- 当前是 SPA，SEO 不是主要目标。

### 9.2 推荐库

- frontmatter：`gray-matter` 或前端轻量 frontmatter parser。
- Markdown：`markdown-it` 或 `marked`。
- 标题锚点：`markdown-it-anchor` 或渲染后补 id。
- LaTeX：`katex` + Markdown 插件。
- 代码高亮：`highlight.js`，后续可升级 `shiki`。
- HTML 清理：如允许 Markdown 内 HTML，需使用 `DOMPurify`。

### 9.3 Markdown 文章结构

Markdown 文章页由前端包壳：

```text
目录路径 · 时间
文章标题
Markdown 正文
```

正文套用站点统一 `.markdown-body` 样式，保持 Botanical Organic Serif：

- 正文使用 `Newsreader` / 中文宋体 fallback。
- 标题使用 `Fraunces`。
- 代码使用等宽字体。
- blockquote、table、code block、math block 都单独设计。

### 9.4 LaTeX

Markdown 内支持：

```md
行内公式：$f(x)=x^2$

块级公式：

$$
\int_0^x t^2 dt = \frac{x^3}{3}
$$
```

前端渲染为 KaTeX HTML，并加载 KaTeX CSS。

## 10. HTML 文章加载方案

### 10.1 iframe 原样加载

HTML 文章内容区只保留 iframe 原 HTML，不额外显示目录路径、时间和文章标题。

```html
<iframe
  class="html-article-frame"
  src="/content/posts/0x0%20-%20Inbox/page.html?v=1783331520000"
  title="Page"
></iframe>
```

这样可以最大限度保留原 HTML：

- 原 `<head>`、`<style>`、`script` 生效。
- 原标题、导航、布局和交互全部保留。
- 站点 CSS 不污染 HTML 文章。

顶部站点栏仍可保留 `Back`，但文章正文区域不添加额外站点标题。

### 10.2 iframe 滚动与跳转

HTML iframe 可以自己滚动，站点 Overlay 固定在视口两侧：

```css
.html-article-frame {
  width: 100%;
  height: calc(100vh - var(--topbar-height));
  border: 0;
}
```

outline 点击跳转不需要刷新页面：

- 同源 iframe 中可使用 `iframe.contentDocument.getElementById(id).scrollIntoView()`。
- 若 heading 没有 id，可在 iframe load 后临时补 id。
- 避免通过反复修改 iframe `src` 来跳转，减少 iframe 重新导航的可能。

### 10.3 HTML 轻量链接脚注

HTML 保真优先，但可在 iframe load 后做轻量链接脚注增强：

- 只处理外部链接。
- 不处理 `href="#section"` 这类页内导航。
- 不更改原链接字体样式。
- 给原链接增加虚线下划线。
- 在链接左上角加较小上标数字。
- 右侧引用 Overlay 的序号与正文上标对应。

推荐实现方式：

```css
a[data-wvd-ref] {
  position: relative;
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-underline-offset: 0.18em;
}

a[data-wvd-ref]::before {
  content: attr(data-wvd-ref);
  position: absolute;
  left: -0.65em;
  top: -0.75em;
  font-size: 0.62em;
  line-height: 1;
}
```

注入 CSS 时应尽量低侵入，不设置 font-family、font-weight、color 等字体相关样式。

## 11. 文章大纲与引用 Overlay

### 11.1 Overlay 布局

文章页结构：

```text
topbar
  brand                           Back

article-stage
  left outline rail  | article content | right references rail
```

左右 rail 使用 `position: fixed`，不占中间文章布局空间。

```css
.article-rail {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  z-index: 20;
}
```

### 11.2 收起态

收起态只显示线条：

- `h1`：最长、最粗。
- `h2`：中等。
- `h3`：较短。
- `h4-h6`：更短更细。

### 11.3 展开态

鼠标移入 rail：

- 宽度从线条宽度过渡到文本宽度。
- 显示完整标题或引用文字。
- 当前 hover 项放大。
- 上下邻近项按距离轻微放大，形成类似 Mac Dock 的缩放效果。
- 鼠标移出后恢复线条态。

实现方式：

- CSS 控制 rail 展开、收起、透明度、宽度。
- JS 在 `pointermove` 时计算每一项中心点与指针 Y 距离。
- 将缩放值写入 CSS variable。

```js
scale = 1 + Math.max(0, 1 - distance / 120) * 0.45
```

### 11.4 大纲提取

Markdown：

- 前端渲染 Markdown 后，从 `.markdown-body` DOM 中提取 `h1-h6`。
- 为没有 id 的 heading 生成稳定 id。
- outline 点击使用 `scrollIntoView()`，不刷新页面。

HTML：

- iframe load 后，从 `iframe.contentDocument` 提取 `h1-h6`。
- 为没有 id 的 heading 临时补 id。
- outline 点击使用 iframe 内的 `scrollIntoView()`，不刷新页面。

HTML active heading 后续可通过同源 iframe 内的 `IntersectionObserver` 增强；MVP 先实现点击跳转即可。

### 11.5 引用提取

Markdown：

- Markdown 渲染完成后，从 DOM 中提取外部链接。
- 排除图片链接。
- 排除 `href="#section"` 这类页内锚点。
- 给正文链接添加序号上标。

HTML：

- iframe load 后，从 iframe DOM 中提取外部链接。
- 排除页内锚点和空链接。
- 给原链接加轻量下划线和左上角上标。

引用数据结构：

```json
{
  "index": 1,
  "text": "显示文本",
  "href": "https://example.com",
  "kind": "external"
}
```

右侧引用列表：

```text
1 显示文本
2 另一条引用
```

右侧引用样式与左侧大纲保持一致。

## 12. 前端改造方案

### 12.1 路由

建议继续使用 hash 路由，减少 nginx SPA 配置复杂度：

```text
#/                         Latest
#/folder/posts/0x0%20-%20Inbox
#/article/posts/0x0%20-%20Inbox/note.md
#/article/posts/0x0%20-%20Inbox/page.html
```

不要再用“路径最后是否 `.html`”判断路由类型，应显式区分 `folder` 和 `article`。

### 12.2 顶栏

顶栏右侧区域根据页面状态显示：

- 首页/列表页：为空。
- 文章页：显示英文 `Back`。

`Back` 行为：

- 优先回到打开文章前的目录或 Latest。
- 如果没有来源状态，则回到文章所在叶子目录。

### 12.3 左侧目录树

目录树保持当前整体样式，主要改动小圆点：

- 箭头图标改为墨绿色圆点。
- 当前打开的叶子目录及所有父目录：左侧小圆点亮浅绿色。
- 普通目录、仅展开目录：左侧小圆点保持墨绿色。
- 当前已有目录点击样式不大改。
- 有子目录的目录：点击展开/收起。
- 叶子目录且有文章：点击加载右侧文章列表。
- 空叶子目录：点击无反应，鼠标按下时可短暂变色，松开还原。
- 数量显示后代文章总数。

### 12.4 右侧文章列表

列表项字段：

- 创建日期。
- 标题。
- 文章总结。

移除：

- 阅读时间。

列表项高度由文章总结自然撑开，不截断。

默认页：

- 标题从 `Posts` 改为 `Latest`。
- 展示全站有效文章，按时间倒序。

叶子目录页：

- 标题为叶子目录显示名。
- 只展示该叶子目录直接文章。

### 12.5 文章页

Markdown：

```text
目录路径 · 时间
文章标题
Markdown 正文
```

HTML：

```text
iframe 原 HTML
```

HTML 文章不显示额外站点文章标题和 metadata，避免与原 HTML 标题、导航重复。

## 13. 样式方向

继续沿用当前 Botanical Organic Serif 基础：

- 主色：森林绿、鼠尾草绿、象牙白、陶土色。
- 目录圆点使用墨绿色；当前打开路径圆点使用浅绿色。
- 列表卡片保持当前温和纸面感，但文章总结不截断。
- Markdown 正文样式与当前 `.article-body` 一脉相承，但重命名为 `.markdown-body`，避免影响 iframe HTML。
- Overlay rail 使用半透明背景或无背景，尽量像浮在纸面边缘的“目录标尺”。
- 可继续使用 `:has()` 等现代 CSS 能力，目标为 Chrome、Edge、Safari 等主流浏览器。

移动端：

- 默认隐藏左右 rail。
- 使用左右边缘小按钮或顶部按钮打开大纲/引用面板。
- 面板以 overlay / drawer 形式出现，不挤压正文。

## 14. nginx 与部署

### 14.1 nginx 示例

```nginx
server {
  listen 80;
  server_name example.com;

  root /var/www/woboks-vibe-daily;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:17321;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /content/posts/ {
    alias /var/www/woboks-vibe-daily/posts/;
    try_files $uri =404;
  }

  location ~ _manifest\.json$ {
    return 404;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### 14.2 缓存建议

- `index.html`：短缓存或 no-cache。
- `app.js` / `style.css`：如无构建 hash，短缓存。
- `/api/*`：no-store 或 no-cache。
- `/content/posts/*`：使用 ETag / Last-Modified，iframe URL 同时加 `v=mtimeMs`。

### 14.3 Node 进程

本地开发：

```text
node server/index.js
```

生产可用：

- systemd
- pm2
- Docker

个人站点建议先用 systemd 或 pm2，简单可靠。

## 15. 潜在问题与建议

### 15.1 文件监听性能

问题：担心监听系统一直遍历文件夹。  
建议：启动时扫描一次，之后依赖文件系统事件。只有在特殊文件系统或启用 polling 时才可能反复扫描，生产部署应避免 polling。

### 15.2 只用文章数量判断 manifest 会漏更新

问题：文章数量不变时，标题、总结、日期、正文链接变化不会触发重建。  
建议：marker 使用 `articleCount + signature`，signature 包含文件名、mtime、size。

### 15.3 manifest 写入触发 watcher 循环

问题：后端写 `_manifest.json` 可能被监听器捕获，导致重复重建。  
建议：watcher ignore `_manifest.json`，且写入 manifest 使用原子写：先写临时文件，再 rename。

### 15.4 删除或移动文件

问题：移动不是单一事件，通常会拆成删除和新增。  
建议：对 `unlink + add`、`unlinkDir + addDir` 都按目录树变化处理，重建旧目录、新目录和根 manifest。

### 15.5 浏览器缓存不同步

问题：服务器文件已变化，浏览器仍显示旧内容。  
建议：API 不缓存，内容文件使用 ETag / Last-Modified，HTML iframe URL 加 `v=mtimeMs`。

### 15.6 HTML 链接脚注影响原样式

问题：HTML 原样保留和链接脚注增强存在轻微冲突。  
建议：只加虚线下划线和左上角上标，不改变字体、颜色、布局结构；只处理外部链接。

### 15.7 完整 HTML 内部导航污染引用列表

问题：完整 HTML 页面里可能有很多 `href="#section"` 导航链接。  
建议：页内锚点不进入右侧引用，只进入或影响大纲跳转逻辑。

### 15.8 HTML iframe active outline 较复杂

问题：iframe 内滚动时，父页面不容易感知当前 heading。  
建议：MVP 先支持点击跳转；active heading 后续通过同源 iframe 内 `IntersectionObserver` 增强。

### 15.9 Markdown XSS 风险

问题：Markdown 如果允许原始 HTML，可能注入脚本。  
建议：默认禁用 Markdown 内原始 HTML，或使用 `DOMPurify` 做白名单清理。

### 15.10 文件名和路径编码

问题：当前已有中文文件名和带空格目录名。URL、hash、API 参数必须正确 encode/decode。  
建议：API 使用 query 参数传 `path`，前端统一 `encodeURIComponent`，后端严格 normalize。

### 15.11 移动端 Overlay 空间不足

问题：左右 rail 在手机上会遮挡正文。  
建议：移动端隐藏 rail，用边缘按钮或顶部按钮打开 overlay / drawer。

## 16. 推荐落地步骤

### Phase 1：Node 后端基础

1. 新增 `package.json` 与 `server/`。
2. 实现路径校验、有效 `0x` 目录扫描、叶子目录识别。
3. 实现 Markdown/HTML metadata 提取。
4. 生成根 `_manifest.json` 与叶子 `_manifest.json`。
5. 提供 `/api/tree`、`/api/latest`、`/api/folder`、`/api/article`。
6. 实现文件监听、debounce、移动/删除处理和缓存控制。

验收：

- 启动 Node 后自动构建 manifest。
- 新增、删除、修改、移动文章后 manifest 自动更新。
- `Latest` API 按时间返回全站有效文章。
- 非 `0x` 目录和非叶子目录文章不进入结果。

### Phase 2：前端列表与目录

1. 重写 `app.js` 路由为显式 `folder/article`。
2. 移除顶部日期。
3. 目录树箭头改为小圆点。
4. 当前打开目录路径通过小圆点浅绿色体现。
5. 默认页改为 `Latest`。
6. 叶子目录只显示直接文章。
7. 空叶子目录点击无反应。
8. 移除阅读时间，列表显示创建日期、标题、文章总结。

验收：

- 首页右侧显示 `Latest`。
- 点击叶子目录显示正确列表。
- 非叶子目录只展开/收起。
- 文章总结完整显示。

### Phase 3：文章页双渲染

1. Markdown 由 `/api/article` 获取原文，前端渲染。
2. Markdown 页面显示目录路径、时间、文章标题和正文。
3. HTML 由 iframe 加载 `/content/posts/...?...`。
4. HTML 内容区不额外显示站点文章标题和 metadata。
5. 顶栏右侧显示英文 `Back`。

验收：

- Markdown 文章显示统一站点样式。
- Markdown LaTeX、代码块、表格正常。
- HTML 完整页面保持原样式和脚本。
- Back 返回来源列表。

### Phase 4：Overlay 大纲与引用

1. 前端从 Markdown DOM 提取大纲和引用。
2. 前端从 HTML iframe DOM 提取大纲和引用。
3. 左侧大纲支持线条态、hover 展开、Dock 缩放、点击跳转。
4. 右侧引用支持线条态、hover 展开、点击打开链接。
5. Markdown 链接添加上标序号。
6. HTML 链接添加虚线下划线和左上角上标。
7. 移动端使用按钮打开大纲/引用面板。

验收：

- Markdown 大纲和引用可用。
- HTML 大纲和引用可用。
- outline 点击不刷新页面。
- 移动端不遮挡正文。

### Phase 5：部署与清理

1. 配置 nginx。
2. 配置 Node 进程管理。
3. 禁止外部直接访问 `_manifest.json`。
4. 修正 HTML meta 中未转义的引号。
5. 经确认后清理非 `0x` 测试目录和散落文章文件。

## 17. 测试方案

### 17.1 后端测试

- `pathGuard` 阻止 `../`。
- scanner 只识别 `0x` 分类目录。
- scanner 正确识别叶子目录。
- 非叶子目录文章不进入 manifest。
- Markdown frontmatter 优先级正确。
- HTML meta / title / h1 fallback 正确。
- marker signature 能识别内容修改。
- add / change / unlink / addDir / unlinkDir 后 manifest 正确更新。

### 17.2 API 测试

- `/api/tree` 返回目录树与总数。
- `/api/latest` 排序正确。
- `/api/folder` 拒绝非叶子目录。
- `/api/article` 对 Markdown 返回原文。
- `/api/article` 对 HTML 返回带版本参数的 iframe url。

### 17.3 浏览器验证

- 首页 Latest。
- 目录展开/收起。
- 当前打开目录路径的小圆点高亮。
- 空叶子目录点击无反应。
- 文章总结完整显示。
- Markdown LaTeX、代码块、表格。
- HTML 完整页面保真。
- HTML 链接只有虚线下划线和左上角上标增强。
- 左右 Overlay hover 动画。
- outline 点击不刷新页面。
- Back 按钮。
- 移动端大纲/引用面板不遮挡正文。

## 18. MVP 决策建议

1. manifest 物理文件使用 `_manifest.json`，marker 放 JSON 字段。
2. 文件监听是主路径，API 请求只做兜底校验。
3. Markdown 前端渲染，Node 返回原文和 metadata。
4. 大纲与引用提取放在前端。
5. HTML iframe 原样加载，只做轻量链接脚注增强。
6. active outline 对 Markdown 优先实现；HTML iframe active 状态后续增强。
7. 只识别 `0x` 分类目录，非 `0x` 测试内容不进入构建结果。

这套方案可以保留当前站点的视觉气质，同时把内容发布链路升级为“文件即发布、自动更新索引”的个人知识站。
