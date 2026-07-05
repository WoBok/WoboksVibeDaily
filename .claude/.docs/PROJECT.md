# WoBok's Vibe Daily — 项目备忘

> 纯静态个人博客。无框架、无后端、无构建链（仅一个 Python 清单生成脚本）。
> 本备忘只记录主博客（仓库根目录），不含 `dumbbear/`、`normandylandings/` 子项目。

## 一句话架构

`index.html`(外壳) + `app.js`(hash 路由 SPA，渲染逻辑全在这) + `style.css`(设计系统) + `manifest.json`(文章清单) + `_build_manifest.py`(生成清单的 Python 脚本) + `posts/`(文章源)。

## 技术栈

- 原生 JS（IIFE + `'use strict'`），ES2015+，无打包。
- hash 路由 `#/path`（`location.hash`），`hashchange` 监听。
- `DOMParser` 解析 fetch 来的文章 HTML，读 `<meta>` 取标题/日期/摘要/阅读时长/分类。
- Google Fonts：Fraunces / Newsreader / DM Mono。
- 设计令牌走 `:root` CSS 自定义属性；纸质质感用 SVG `feTurbulence` 噪声。
- Python 3 脚本扫描 `posts/`，正则抽 meta，写 `manifest.json`。

## 运行与构建

- 本地预览：`python -m http.server 8000`（仓库根目录），开 `http://localhost:8000`。
- 改了 `posts/` 后**必须**跑：`py _build_manifest.py`（否则前端看不到变化——浏览器无法列目录，全靠 manifest 索引）。
- 直接打开 `index.html`（file://）不行，需要 http server。

## 路由与渲染（app.js 核心）

- `state`：`{ manifest, currentFolder:'posts', currentArticle, openFolders:Set }`。
- `parseHash()`：`#/a/b/c.html` → 文章；`#/a/b/` → 文件夹。
- `loadManifest()`：`fetch('manifest.json', {cache:'no-cache'})`。
- 渲染三路径：
  - `renderList(folder)` — 递归收集该文件夹下所有 `.html`，输出面包屑+标题+lede+卡片列表（60ms 错峰动画）。侧栏可见。
  - `renderArticle(path)` — `fetch` 文章 → DOMParser → 读 5 个 meta → 注入 `<article>` 进 `.article-body`，加返回键，进阅读模式（隐藏侧栏 `#sidebar.is-hidden`），滚顶。
  - `renderTree()` — 侧栏只列文件夹（文件在主区列表里），带直系文件数徽标。
- `render()` 总入口：文件夹→`renderList`；文章→自动展开父级链+`renderArticle`；末尾恒调 `renderTree()`。
- 启动顺序：`renderDate()` → `loadManifest()` → `render()`，并监听 `hashchange`。
- 文章路径**必须含 `.html`**（manifest 的 `path` 字段形如 `posts/xxx.html`）。

## 文章规范（posts/）

每篇是独立 `.html` 片段，模板：

```html
<head>
  <meta name="title" content="标题">
  <meta name="summary" content="摘要 lede">
  <meta name="date" content="2026-06-05">
  <meta name="read-time" content="9 min">
  <meta name="category" content="Technical">
</head>
<body><article> 正文（可用 h2/p/blockquote/pre/code） </article></body>
```

- 5 个 meta 必填；`<article>` 包裹**强制**；**禁止**自带 `<style>`/`<link>`（正文样式由 `style.css` 全局 `.article-body` 后代选择器接管）。
- 文件名：`YYYY-MM-DD-slug.html` 或 `slug.html`。meta 优先级高于文件名。
- 现有 9 个分类文件夹 / 20 篇：code-snippets, diary(含 2025/2026 年份子目录), essays, fragments, library, notes, projects, reading, technical。

## 新增分类必须改两处

加一个新分类文件夹只建目录不够——前端显示名和文案是硬编码映射：

- `app.js` 的 `folderDisplayName(name)`：分类目录名 → 显示名（如 `essays→Essays`，`code-snippets→Snippets`，`diary/2026→2026`）。未命中则走 `titleFromFilename` 兜底。
- `app.js` 的 `ledeForFolder(path)`：路径 → 文件夹引语文案。未命中则兜底「这一卷里的笔记。」
- 然后跑 `py _build_manifest.py`。

## 设计系统速记

`style.css` 的 `:root` 令牌：

- `--ivory:#F9F8F4`（底）/ `--forest:#2D3A31` / `--sage:#8C9A84` / `--clay:#C27B66`（点缀）/ `--ink:#1F2620`。
- 圆角变量；`--ease-organic`；`--dur-slow:680ms`。
- `.topbar` sticky + `backdrop-filter: blur(14px) saturate(140%)` 玻璃顶栏。
- `.layout` CSS Grid：`minmax(280px,1fr) 2fr`，`max-width:1400px`。
- 主题基调：植物有机衬线（Botanical Organic Serif）。

## 已知不一致 / 坑

- **遗留 Hugo 痕迹**：`.claude/settings.local.json` 里有 `rm -rf config.toml content layouts assets static .hugo_build.lock`、`mv public/* .` 等 Hugo 时代权限项；`_build_manifest.py` 注释写「扫描 `public/posts/`」但实际扫 `./posts`。疑似从 Hugo 迁移而来，残留无害但易误导。
- **端口不一致**：startserver Skill 起 8000，settings 里的健康检查 curl 打 8765。以 8000 为准。
- **排序是字母序非日期序**：manifest 子项按「文件夹优先 + 名字小写升序」，列表**不**按时间倒排。
- **「dumbbear」歧义**：子项目目录 `dumbbear/`（短片馆）与博文 `posts/projects/dumbbear.html`（短链服务）同名但无关。
- 仓库仅 1 条 git 提交；根目录无 `.gitignore`（`.idea/` 等会被跟踪）。
