# WoBok's Vibe Daily — 笔记功能设计文档

> 配套阅读：`PROJECT.md`（项目备忘）。本文件只讲「要做什么、怎么改」，不含子项目（`dumbbear/`、`normandylandings/`）。

## 0. 范围与约束

- **目标**：在现有博客上，新增 Markdown 支持、重做左侧目录树交互、重做文章页为「左大纲 / 中正文 / 右引用」三栏 overlay 布局；并把内容索引从「手跑 Python 脚本生成单一 manifest」改成 **nginx 反代一个极薄 Node 索引服务，运行时按需生成 + 增量缓存**——写完文章上传即生效，无需构建。
- **硬约束（不可变）**：网站视觉表现风格完全保留——
  - 配色令牌（`--ivory/--forest/--sage/--sage-light/--clay/--moss/--ink` 等，见 `style.css` `:root`）；
  - 字体（Fraunces / Newsreader / DM Mono）；
  - 纸质 `feTurbulence` 噪声、玻璃顶栏 `backdrop-filter`、`--ease-organic` 缓动、圆角变量；
  - 整体「Botanical Organic Serif」基调。
- **架构变化（本阶段）**：由「纯静态、无后端」变为「静态前端 + 极薄 Node 索引服务，nginx 反代」。Node **只做目录读取 + manifest 生成/缓存，不碰渲染**（渲染仍全在浏览器）。`_build_manifest.py` 与根 `manifest.json` 退役。
- 视觉落地只用现有令牌颜色，不引入新色系。

---

## 1. 总体架构（改动后）

```
posts/{*.html, *.md}                         ← 文章源（新增 .md）
        │  nginx 直出静态 / 反代 /api/ 给 Node
        ▼
┌──────────────── nginx ────────────────┐
│  静态：index.html / app.js / style.css       │
│        posts/*.md|*.html（含文章正文）         │  → nginx 直出
│  /api/tree            ─┐                   │
│  /api/index?folder=…   ─┤  proxy_pass → 127.0.0.1:PORT
└────────────────────────┼───────────────────┘
                         ▼
          极薄 Node 索引服务（常驻，systemd / pm2）
            • readdir + stat 读 posts/ 真实文件系统
            • 按文件夹算「签名」= sorted(文件名+mtime) 的 hash
            • 签名一致 → 返回内存缓存的 manifest
            • 不一致 → 仅重解析 mtime 变了的文件（增量），更新缓存
            • (可选) 落盘 posts/<folder>/.manifest.json，nginx try_files 兜底
        │  JSON
        ▼
index.html(外壳) + app.js(hash 路由 SPA)
        ├─ /api/tree          → renderTree（侧栏：文件夹结构 + 直接文件数）
        ├─ /api/index?folder= → renderList（右侧：时间 · 标题 · 总结）
        └─ 文章路由 → renderArticle（fetch 文章正文，走 nginx 静态直出，不经 Node）
              ├─ .html → DOMParser 注入（沿用）
              └─ .md   → fetch 文本 → markdown-it → KaTeX → highlight.js → 注入
                          ↑ 之后统一从渲染后 DOM 抽 h1/h2/h3 与 <a>
        ▼
文章页 overlay（仅文章视图）：
  左栏 .toc-rail（大纲，Dock 缩放）｜ 中栏正文 ｜ 右栏 .ref-rail（引用，同机制）
```

**关键性质**：没有构建步骤、没有要手敲的脚本。上传/改文章后，下一次点开该文件夹，Node 看到文件变了（签名不一致）就增量重建，前端立得新数据。**读文章本身不依赖 Node**（文章正文由 nginx 静态直出）；Node 挂了只影响目录树与列表（可被 §4.6 落盘兜底覆盖）。

**运行 / 预览**：
- 生产：nginx 直出静态 + `location /api/ { proxy_pass http://127.0.0.1:PORT; }` 反代 Node；Node 由 systemd/pm2 守住。
- 本地：直接跑 Node 服务（开发模式可顺带 serve 静态文件，免去本地 nginx）；或本地也起 nginx 对齐生产行为。不再用 `python -m http.server`。

**新增运行时依赖**：
- 服务端：Node（极薄 HTTP 服务，~单文件，只用内置 `fs`/`http`/`crypto`，可零第三方依赖）。
- 浏览器（CDN，懒加载，仅打开 `.md` 时注入）：

| 用途 | 库 | 备注 |
|---|---|---|
| Markdown→HTML | `markdown-it` | 解析期处理数学 token，公式不会被代码块误伤 |
| LaTeX | `KaTeX`（js+css+auto-render，经 markdown-it 插件如 `markdown-it-texmath` 接入） | 比 MathJax 轻、快 |
| 代码高亮 | `highlight.js`（js + 任一主题 css） | markdown-it 输出 `<pre><code class="language-xxx">`，hljs 着色 |

> 不引入打包/前端框架。CDN 资源首次加载后浏览器缓存。

---

## 2. 文件格式规范

> 规范本身（作者写什么）不变；变化的是「谁来读」——由 Node 在请求时读取并解析（见 §4），不再由 `_build_manifest.py` 离线扫。

### 2.1 Markdown（新增）

文件头 YAML front-matter（可选但推荐），之后是正文：

```markdown
---
title: On Quietness            # 可选；缺省=文件名
summary: 关于安静的三件事……      # 推荐；缺省=自动抽取首段
date: 2026-06-20               # 必填建议
---

# 关于难熬

正文。行内公式 $E = mc^2$，块公式：

$$
\int_0^1 x^2\,dx = \tfrac{1}{3}
$$

代码：

​```python
def f(x): return x * 2
​```

引用与链接：见 [Anthropic](https://www.anthropic.com)。
```

- 支持完整 Markdown：标题 / 段落 / 列表 / 引用 / 代码（带语言）/ 链接 / 图片 / 表格 / 分隔线。
- LaTeX：行内 `$...$`、块级 `$$...$$`。
- 链接 `[文本](url)` 会同时成为右栏「引用」来源（见 §6）。

### 2.2 HTML（沿用，微调）

```html
<head>
  <meta name="title"    content="标题（可选，缺省=文件名）">
  <meta name="summary"  content="列表里的总结（推荐，缺省=自动抽取首段）">
  <meta name="date"     content="2026-06-05">
</head>
<body><article> 正文 </article></body>
```

- **去掉 `read-time`**（本阶段不再展示；为向后兼容，meta 仍可存在但被忽略）。
- **去掉 `category`**：分类即文件夹，「目录路径」已替代它（见 §7）。
- `<article>` 包裹仍强制；禁止自带 `<style>`/`<link>`（正文样式由 `style.css` 的 `.article-body` 后代选择器接管，Markdown 渲染产物同样注入此容器、共用样式）。

### 2.3 通用约定

- 文件名：`YYYY-MM-DD-slug.md` / `slug.md` / 中文名均可（**注意见 §9 边界**）。meta/front-matter 优先级高于文件名。
- 格式判定：按扩展名 `.md` / `.html`，写入 manifest 的 `format` 字段。

---

## 3. 笔记总结（summary）：放哪里、怎么加载 —— 重点建议

> 结论先行，再给理由。**与旧版唯一区别**：抽取从「构建期 Python」改为「Node 运行时 + 增量缓存」——作者无感，但 summary 永远随文章实时更新。

### 决策

| 维度 | 建议 |
|---|---|
| **放哪里（来源）** | 写在文件元数据里：MD 用 front-matter `summary:`；HTML 用 `<meta name="summary">`。统一字段名 `summary`。 |
| **怎么加载（到列表）** | **Node 运行时**：点开文件夹时 `GET /api/index?folder=` 由 Node 读取并解析每篇文件抽取 `summary`，**增量缓存**（仅 mtime 变了的文件重解析）。前端列表直接用响应里的 `summary`，不逐篇 fetch。 |
| **没写怎么办（兜底）** | Node 抽取正文首段：MD 去标记后取首个非空段落；HTML 取 `<article>` 内首个 `<p>`。截到约 80 字 / 一行，尾加「…」。草稿也能在列表里显示一句话预览。 |
| **显示在哪** | **仅**右侧文章列表卡片（时间 · 标题 · 总结）。文章详情页**不显示** summary（页面顶部是「目录路径 · 时间 / 标题 / 正文」）。 |

### 理由

1. summary 跟随文件本身存（front-matter / meta），Node 只负责读取——上传即最新，无需手动构建。
2. 作者显式写优先于自动抽取：可控、精准；自动抽取只兜底，不抢戏。
3. 列表-only：summary 语义是「目录里的预览」，进正文就不需要了，避免与正文重复。
4. 兜底在 Node 内做，manifest（即 `/api/index` 响应）永远完整，前端不担心空字段。
5. 增量缓存：几百篇的文件夹，实际只重解析 mtime 变了的那 1 篇，性能有保证。

---

## 4. manifest 与索引服务（Node，取代 `_build_manifest.py`）

> 这是本阶段架构的核心变化。原 `_build_manifest.py` + 单一根 `manifest.json` **退役**，改为 nginx 反代的极薄 Node 服务，按文件夹懒加载、签名校验、增量解析。

### 4.1 服务职责

- 只读 `posts/` 真实文件系统，**不预生成、不落地**（除非开 §4.6 可选落盘）。
- 两个端点：`GET /api/tree`、`GET /api/index?folder=`。
- 全部基于「签名 + 每文件 (name→mtime+meta) 缓存」，进程内缓存；可选落盘兜底。
- 可零第三方依赖（仅 `fs`/`http`/`crypto`）。

### 4.2 `GET /api/tree` — 侧栏树

返回纯文件夹结构（**不含文章元数据**，避免膨胀），供侧栏渲染：

```jsonc
{
  "name": "posts", "path": "posts", "type": "folder",
  "count": 20,                      // 后代 .md+.html 总数（可选，用于徽标）
  "children": [
    { "name": "essays", "path": "posts/essays", "type": "folder",
      "count": 3, "children": [ /* 仅文件夹，递归 */ ] },
    { "name": "0x0 - Inbox", "path": "posts/0x0 - Inbox", "type": "folder",
      "count": 4, "children": [] }
  ]
}
```

- 只递归文件夹节点；文件节点不出现在 tree 里（文件清单在 `/api/index`）。
- `count` = 该文件夹**直接**子文件数（侧栏徽标用）。
- 整树缓存，按 `posts/` 顶层签名失效（结构很少变；变了再重扫，仍只读目录不读文件内容）。

### 4.3 `GET /api/index?folder=posts/essays` — 某文件夹文章清单

```jsonc
{
  "folder": "posts/essays",
  "signature": "a1b2c3",            // 该文件夹的签名（见 4.4），即「标记位」
  "files": [
    { "name": "on-quietness.md",
      "path": "posts/essays/on-quietness.md",
      "format": "md",
      "title": "On Quietness",
      "date": "2026-06-20",
      "summary": "关于安静的三件事……" },
    /* …其余文件… */
  ]
}
```

- `format`、`title`、`date`、`summary` 由 Node 解析得到（MD 走 front-matter，HTML 走 `<meta>` 正则；summary 缺省走 §3 兜底）。
- 不含 `readTime`/`category`。

### 4.4 签名 + 增量缓存（你的「计数标记」的工程化升级）

> 你的原方案：manifest 第 1 行存数量，和实际文件数比，不一致才重建。**问题**：改了某篇标题/总结/正文，文件数不变 → 计数一致 → 不重建 → 显示旧的。「编辑」比「增删」频繁，会踩坑。改用签名修掉这个盲区，开销几乎一样。

**签名** = 该文件夹下所有 `.md`/`.html` 的 `sorted(文件名 + mtimeMs)` 拼接后 hash。每次请求 Node `readdir` + `stat`（极快，几百文件毫秒级）算签名：

```
请求 /api/index?folder=X
  ├─ 算签名 sig = hash(sorted(name+mtime) for files in X)
  ├─ 缓存命中且 cached.signature === sig → 返回 cached.manifest     ✅ 增删+编辑都能命中
  └─ 不一致 → 增量重建：
        for each file f in X:
          prev = cached.files[f.name]
          if prev && prev._mtime === f.mtime → 复用 prev（不重读）   ✅ 只重解析变的
          else → readFile + 解析 front-matter/meta → 得到 meta，记 _mtime
        写缓存（含新签名），返回
```

- 增删、改名、改内容（mtime 变）都能发现；只重解析真正变了的文件。
- 每文件缓存带 `_mtime`（不返回给前端，仅服务端用），实现单文件级复用。

### 4.5 路径校验（防穿越，必须做）

`folder` 参数必须钉死在 `posts/` 之下，否则 `?folder=../../etc` 能读服务器任意文件：

```js
const POSTS_ROOT = path.resolve('/var/www/blog/posts');   // 配置项
function resolveFolder(folder) {
  const resolved = path.normalize(path.join(POSTS_ROOT, folder || ''));
  if (resolved !== POSTS_ROOT && !resolved.startsWith(POSTS_ROOT + path.sep)) {
    throw new Error('invalid folder path');
  }
  return resolved;
}
```

- 同时限定扩展名 `.md`/`.html`；非 posts 子树一律拒。


### 4.6 文件夹显示名（降低「新增分类必改两处」的摩擦）

现状：`folderDisplayName()` / `ledeForFolder()` 是 `app.js` 里硬编码 map，新文件夹（如已有的 `0x0 - Inbox`）落到兜底，文案生硬。建议 Node 在 `/api/tree` 里直接给 `title`/`lede`，按优先级链：

1. 文件夹内若有 `index.md` / `index.html`，读其 front-matter / meta 的 `title`、`summary` 作为该文件夹显示名与 lede；
2. 否则用文件夹名按规则转写（`0x0 - Inbox` → `Inbox`，`code-snippets` → `Snippets`）；
3. 硬编码 map 仅作「显示名覆盖」兜底（可移到 Node 侧配置文件）。

> 加新分类只需建目录（可选放个 `index.md` 写名字/简介），不再必改 JS。

---

## 5. 路由与渲染管线（`app.js`）

### 5.1 路由

- `parseHash()`：判定文章的条件由「`.endsWith('.html')`」扩展为「`.endsWith('.html') || .endsWith('.md')`」。
- hash 形如 `#/essays/on-quietness.md`。`setHash`/`parseHash` 一律 `encodeURIComponent`/`decodeURIComponent`（**见 §9：含空格/中文路径**）。

### 5.2 渲染分流

```
render()
 ├─ folder → renderList(path)            // 右侧列表：fetch /api/index?folder=path
 └─ article → renderArticle(path)        // fetch 文章正文（nginx 静态直出，不经 Node）
      ├─ manifest 查 format（来自上次 /api/index 缓存；或无则按扩展名）
      ├─ format==='html' → DOMParser 流程（沿用）
      └─ format==='md'   → renderMarkdown(path)（新增）
```

启动顺序：`renderDate()` → `loadTree()`（fetch `/api/tree`）→ `render()`，监听 `hashchange`。
> 注：`loadTree()` 取代旧 `loadManifest()`。

### 5.3 Markdown 渲染管线（新增）

```
fetch(path) → text                          // 走 nginx 静态
  → 剥 front-matter（取 title/date 兜底）
  → markdown-it.render(body)                // 产出 HTML 字符串
  → 注入 .article-body
  → KaTeX 渲染（texmath 已在 parse 期处理 token，auto-render 兜底）
  → highlight.js 着色 .article-body pre code
  → 之后进入「大纲/引用 overlay」构建（§6，统一基于渲染后 DOM）
```

依赖懒加载（首次打开 `.md` 才注入 CDN 脚本/样式，缓存后复用）：

```js
let mdReady = null;
function ensureMarkdown() {
  if (mdReady) return mdReady;
  mdReady = Promise.all([
    loadScript('markdown-it/...umd.js'),
    loadCSS('katex/...katex.min.css'),
    loadScript('katex/...katex.min.js'),
    loadScript('katex/...contrib/auto-render.min.js'),
    loadCSS('highlight/...主题.css'),
    loadScript('highlight/...highlight.min.js'),
    // markdown-it-texmath（或等价）按其文档加载
  ]);
  return mdReady;
}
```

### 5.4 文章页顶部结构（统一两种格式）

按规格「自上往下：1.目录路径 · 时间  2.文章标题（文件名）  3.正文」：

```
.article-headline
  .article-headline__meta     →  「Essays / On Quietness · 2026-06-20」  ← 目录路径 · 时间
  .article-headline__title    →  文章标题（title 字段，缺省=文件名）
.article-body                 →  渲染后的正文
```

> 文章页的 title/date 直接从**已 fetch 的文章正文**解析（MD 的 front-matter / HTML 的 `<meta>`），不依赖 Node。规格写「文章标题（文件名称）」。解读：标题默认取自文件名，**若有显式 `title` 字段则以其覆盖**（与列表一致）。详见 §10 决策点。

---

## 6. 文章页 overlay：左栏大纲 + 右栏引用

两栏机制对称，均为 **`position: fixed` overlay，垂直居中，不影响中栏布局**。

### 6.1 左栏大纲（`.toc-rail`）

- **默认（线条模式）**：左边缘竖向 rail，每个标题 = 一条横向 tick。长短/粗细随级别：`h1` 最长最粗、`h2` 中、`h3` 短而细。整体 `top:50%; transform:translateY(-50%)` 垂直居中。
- **hover（展开文字大纲）**：rail 容器 `mouseenter` → 加 `.is-expanded`：tick 淡出、标题文字 `fade/slide in`，动画用 `--ease-organic`。
- **Dock 缩放**：`mousemove` 计算每项与光标 Y 距离，给每项设 `--scale`（高斯衰减：`scale = 1 + amp * exp(-dy²/2σ²)`）。CSS `transform: scale(var(--scale,1))`，邻近项也放大。`mouseleave` → 移除 `.is-expanded`，收回线条（同样动画）。
- **标题来源**：渲染后 `.article-body` 内 `h1,h2,h3`（MD 的 `#` 与 HTML 的 `<h>` 统一）。为每个标题赋/补 `id`（已有则复用），rail 项 `<a href="#id">`。点击 → 平滑滚动定位。
- **可选增强**：`IntersectionObserver` 让当前可视标题在 rail 上高亮（规格未要求，标注为可选）。

### 6.2 右栏引用（`.ref-rail`）

- overlay 机制、Dock 缩放、线条↔文字切换与左栏完全一致，贴右边缘。
- **来源统一**：渲染后 `.article-body` 内**所有 `<a href>`**。MD 的 `[文本](url)` 与 HTML 的 `<a>文本</a>` 经渲染后都是 `<a>`，故抽取逻辑统一，无需分格式分支。
- **脚注注入**：每个链接就地插入序号 `<sup class="ref-num">n</sup>`（与链接同级，颜色与 rail 一致）。
- **rail 条目**：`n. 显示文本`（可附小号 mono 的域名），**字体颜色与左栏大纲一致**。
- **交互**：点击 rail 条目 → 滚动到正文中对应链接并高亮一瞬；链接本身仍可点击跳转。
- **序号策略**：按出现顺序，**每次出现一个序号**（真脚注语义；同一 URL 多次出现得多个序号）。备选：按 URL 去重——见 §10。

---

## 7. 主界面：左侧目录树交互重做

> 数据源由根 manifest 改为 `GET /api/tree`（§4.2）；交互行为如下。文章视图隐藏 sidebar、改用 overlay（§6）。

### 7.1 圆点替换箭头

- `app.js` 里 `tree-node__icon` 的 SVG chevron → 一个圆点 `<span class="tree-node__dot">`。
- **圆点状态色**（用现有令牌）：

  | 状态 | 圆点色 | 说明 |
  |---|---|---|
  | 收起（默认） | 浅绿 `--sage` | 静止 |
  | 展开 | 墨绿 `--moss`/`--forest` | 已打开 |
  | 选中或其祖先 | 行背景浅绿 `--sage-light`（圆点保持墨绿） | 「路径」高亮 |

  > 规格原文「箭头改成墨绿色圆点 / 选中的目录及所有父目录亮起浅绿色 / 再次点击…圆点恢复浅绿」——解读为：圆点表展开态（展开=墨绿、收起=浅绿），行高亮表选中路径（选中+祖先=浅绿背景）。详见 §10 决策点。

### 7.2 选中 + 祖先高亮

- 当前只高亮 `isActive`（自身，forest 背景）。改为：**选中节点及其全部祖先** row 都加 `is-on-trail` → 浅绿背景。渲染时由 `state.currentFolder` 反推链路。

### 7.3 点击行为

| 情况 | 行为 |
|---|---|
| 有子目录 | 展开/收起切换；**同时**把该目录的直接文章加载到右侧 |
| 叶子目录（无子目录、有文件） | 加载其文章到右侧 |
| 空目录（无任何文件） | 无反应（不切换、不展开） |
| 再次点击已展开目录 | 收起；圆点恢复浅绿；**即便其下有已展开的子目录也一并收起**该层 |

> 规格对「有子目录」只写「展开目录」。本设计采用「展开 + 同时加载本目录文章」（与现状一致、且覆盖「文件夹既有子目录又有直接文件」的一般情形）。见 §10 决策点。

- 文件数徽标（直接子文件数）保留。

### 7.4 与现有 CSS 的映射

- `.tree-node__icon` 相关规则改为作用于 `.tree-node__dot`；`is-open` 旋转动画改为颜色过渡。
- 新增 `.tree-node.is-on-trail > .tree-node__row { background: var(--sage-light); }`。
- 其余 `.tree` 结构、缩进虚线、徽标样式不动。

---

## 8. 主界面：右侧文章列表

- 数据源：`GET /api/index?folder=path`（§4.3），点开叶子文件夹时 fetch。
- 卡片信息：**时间 · 标题 · 总结**（移除阅读时间）。
- `renderList` 里 `post-card__meta` 去掉 readTime 段。
- **高度随总结字数变化**：现状 `.post-card` 是纵向 flex、summary 为 `<p>` 自然撑高，本就满足；维持自然高度，无 `line-clamp`/固定高度。

---

## 9. 边界情况（已在仓库中观测到）

- **含空格/特殊字符的目录与文件名**：`posts/0x0 - Inbox/`、中文文件名（`凝视画布.html`、`函数、极限、导数、微分与积分.html`）。
  - `setHash`/`parseHash` 全程 `encodeURIComponent`/`decodeURIComponent`；
  - Node 端 `/api/index?folder=` 的 `folder` 用原始相对路径（query 解码后直接拼 `POSTS_ROOT`，经 §4.5 校验）；前端请求时 `folder` 也要 `encodeURIComponent`；
  - `folderDisplayName`/`titleFromFilename` 对中文与 `0x0 - ` 前缀需有合理兜底（见 §4.7）。
- **数学文章**：`函数、极限、导数、微分与积分.html`（现为 HTML）若转 `.md`，是 LaTeX 管线的真实验收用例。
- **HTML 旧文件**：现有 20+ 篇 `.html` 不强制改动；`read-time`/`category` meta 可留，Node 忽略、前端不渲染。
- **不再有「manifest 过期」问题**：Node 读真实文件系统，上传即生效，无需手动重建。
- **Node 宕机**：读文章不受影响（nginx 静态直出）；目录树/列表受影响——开 §4.6 落盘兜底可覆盖。

---

## 10. 决策点（请确认；均为「我已替你拍板，若与预期不符请告知」）

1. **索引架构**：nginx 反代极薄 Node 服务，`/api/tree` + `/api/index`，签名 + 增量缓存；退役 `_build_manifest.py` 与根 `manifest.json`。← §1/§4
2. **签名 vs 计数**：用 `sorted(name+mtime)` hash 取代你原方案的「数量标记」，以发现编辑而非仅增删。← §4.4
3. **落盘兜底**：默认关，生产可选开（nginx `try_files`，复用 dumbbear 套路）。← §4.6
4. **圆点状态语义**：圆点表「展开态」（展开=墨绿、收起=浅绿）；行背景表「选中路径」（选中+祖先=浅绿）。← §7.1
5. **有子目录的文件夹点击**：展开 + 同时加载本目录文章（而非「仅展开」）。← §7.3
6. **文章页标题**：取 `title` 字段，缺省=文件名（规格字面写「文件名称」）。← §5.4
7. **引用序号**：按出现顺序每次一个序号（不去重 URL）。← §6.2
8. **Markdown 库**：markdown-it + KaTeX(texmath) + highlight.js（非 marked）。← §1/§5.3
9. **依赖加载**：懒加载（仅 `.md` 打开时注入 CDN）。← §5.3
10. **`category` 字段**：从 manifest/显示中移除，分类即文件夹路径。← §2.2/§4.3

---

## 11. 模块拆分建议（可选）

`app.js` 现 408 行；加入 MD 管线 + 两套 overlay + Dock 缩放后势必破千。建议拆为原生 ES Modules（`<script type="module">`，http 下无 CORS 问题）：

```
app/
  main.js        // 启动、hashchange
  router.js      // parseHash/setHash
  api.js         // loadTree / loadIndex（fetch /api/*）
  tree.js        // renderTree（圆点+路径高亮+点击）
  list.js        // renderList
  article.js     // renderArticle 分流
  markdown.js    // ensureMarkdown + 渲染管线
  overlays.js    // toc-rail / ref-rail（构建+Dock 缩放）
  utils.js       // $ / $$ / titleFromFilename / loadScript/loadCSS
```

Node 侧单文件即可（`server.js`）；若日后端点变多再拆。属「框架逻辑可重写」范围，不强制。

---

## 12. 需要新增/微调的 CSS（仅新增组件类，不改令牌）

- **树**：`.tree-node__dot`（替换 `__icon`）、`.tree-node.is-on-trail > .tree-node__row`。
- **列表**：`.post-card__meta` 去 readTime（删对应段，CSS 不需大改）。
- **overlay 通用**：`.rail`（fixed + 垂直居中基础）、`.rail.is-expanded`、`.rail__item`、`.rail__tick`（线条）、`.rail__label`（文字）、`--scale` 变量驱动 Dock 缩放。
  - 左 `.toc-rail`、右 `.ref-rail` 共用 `.rail` 基类，仅 `left:0` / `right:0` 与对齐方向不同。
- **脚注序号**：`.ref-num`（`<sup>`，墨绿/浅绿，与 rail 文字同色）。
- **Markdown 产物**：复用现有 `.article-body` 后代选择器（`pre`/`code`/`blockquote`/`a` 等已就绪）。KaTeX 用自带主题；如需贴合纸质基调，可微调 `--katex` 相关颜色到 `--ink`/`--forest`（可选）。
- **响应式**：窄屏（`@media max-width:900px`，沿用现有断点）下 overlay rail 隐藏或转为顶部抽屉，避免与正文挤占；`back-button` 现浮于 `left:-160px`，加左 rail 后需重新定位（建议移入文章顶部行或顶栏区，避免与左 rail 冲突）。

---

## 13. 实施步骤（建议顺序）

1. **Node 索引服务骨架**：`server.js` 实现 `/api/tree` + `/api/index` + 签名 + 增量解析 + §4.5 路径校验；本地让 Node 顺带 serve 静态文件做联调。用 `posts/0x0 - Inbox/` 验证中文/空格路径与计数。
2. **nginx 配置**：静态直出 + `location /api/ { proxy_pass http://127.0.0.1:PORT; }`；Node 用 systemd/pm2 守护。
3. **app.js 接 API**：`loadTree()`→`/api/tree`、`renderList`→`/api/index?folder=`；`renderArticle` 按 `format` 分流；`renderMarkdown` 最小可用（先 markdown-it 出 HTML，暂不含 KaTeX/hljs）。
4. **Markdown 完整管线**：接入 KaTeX + highlight.js（懒加载）；用数学文章（《函数、极限…》）验收。
5. **列表微调**：去 readTime；确认高度自适应。
6. **树重做**：圆点、选中+祖先高亮、点击行为（含空目录无反应、再点收起）。
7. **左栏大纲 overlay**：线条模式 + hover 展开 + Dock 缩放。
8. **右栏引用 overlay**：链接抽取 + 脚注注入 + 序号 + rail。
9. **（可选）落盘兜底**：Node 写 `.manifest.json` + nginx `try_files`。
10. **退役旧件**：删除 `_build_manifest.py` 与根 `manifest.json`（确认无引用后）。
11. **响应式 & 回归**：窄屏 overlay 行为、`back-button` 重定位、含空格/中文路径路由全链路。
12. （可选）模块化拆分、文件夹显示名优先级链（§4.7）、滚动高亮当前大纲项。
