# Timeline 功能实现文档

## 目标

在主页左侧文章目录区域新增 `Timeline` 功能，与现有 `Index` 目录共用同一块侧栏区域。用户可以在 `Index · Timeline` 两个标签之间切换：选择 `Index` 时显示原文章目录树，选择 `Timeline` 时显示按月份组织的时间线；点击时间线中的月份数字后，右侧文章列表加载该月文章。

## 现有结构

当前项目核心文件：

- `index.html`：侧栏标题现在是静态的 `<h2 class="sidebar__title">Index</h2>`，目录容器为 `<nav class="tree" id="tree">`。
- `app.js`：负责路由解析、目录树渲染、文章列表渲染、文章页渲染。
- `style.css`：包含侧栏、目录树、列表页、文章页样式。
- `server/index.js`：提供 `/api/tree`、`/api/latest`、`/api/folder`、`/api/article` 等接口。
- `server/services/contentScanner.js`：扫描 `notes` 并生成根 manifest，其中 `root.latest` 已按时间倒序保存所有文章。

已有颜色变量：

- `--moss: #4F5E4A`，可作为当前选中标签颜色。
- `--morandi-red: #B76E6A`，当前 `·` 分隔点和文章列表中的 `·` 使用该色。

## 用户界面

侧栏标题改为标签组：

```html
<div class="sidebar-tabs" aria-label="Sidebar views">
  <button class="sidebar-tab is-active" id="indexTab" type="button">Index</button>
  <span class="sidebar-tab-separator" aria-hidden="true">·</span>
  <button class="sidebar-tab" id="timelineTab" type="button">Timeline</button>
</div>
```

显示效果为：

```text
Index · Timeline
```

样式要求：

- 当前选中标签颜色为 `#4f5e4a`，建议使用 `var(--moss)`。
- 未选中标签保持当前侧栏标题/辅助文字的低调颜色。
- 中间的 `·` 与文章列表中的 `·` 一致，使用 `var(--morandi-red)`，字号和垂直对齐可参考 `.path-separator` 或 `.meta-separator`。
- `Timeline` 和 `Index` 都是可点击区域，不只点击文字本身；按钮应保留无边框、透明背景，延续 Botanical Organic Serif 风格。

侧栏内容容器可复用当前 `#tree` 节点，也可将语义改为通用容器：

```html
<nav class="sidebar-panel" id="sidebarPanel" aria-label="文章目录"></nav>
```

为了减少改动，推荐保留 `id="tree"`，在 Timeline 模式下向该容器写入时间线 DOM。

## 路由与状态

当前路由只支持：

- `#/`
- `#/folder/<path>`
- `#/article/<path>`

新增月份路由：

```text
#/timeline/YYYY-MM
```

`app.js` 中需要扩展：

```js
state.sidebarMode = 'index'; // 'index' | 'timeline'
state.timeline = [];
state.activeTimelineMonth = '';
```

`parseHash()`：

- 识别 `timeline/` 前缀。
- 返回 `{ type: 'timeline', month: '2026-07' }`。
- 对非法月份格式回退到 `{ type: 'latest' }`。

`routeHash(type, path)`：

- 当 `type === 'timeline'` 时返回 `#/timeline/${encodeURIComponent(path)}`。

`isListRoute(route)`：

- 加入 `route?.type === 'timeline'`。

`listRouteKey(route)`：

- `timeline` 路由返回 `timeline:${route.month}`。

`render()`：

- 在 `latest/folder/article` 之外新增 `timeline` 分支。
- 渲染结束后，统一调用 `renderSidebarPanel()`，由当前路由决定侧栏显示 Index 还是 Timeline。

推荐逻辑：

```js
if (state.route.type === 'timeline') {
  didRender = await renderTimelineMonth(state.route.month, renderId, {
    restoreScroll: shouldRestoreListScroll
  });
}
```

## 后端接口

建议新增两个接口：

```text
GET /api/timeline
GET /api/timeline/month?month=YYYY-MM
```

`GET /api/timeline` 返回所有有文章的月份，并保留月份间隔计算所需信息：

```json
{
  "months": [
    {
      "year": 2026,
      "month": 7,
      "key": "2026-07",
      "count": 4
    },
    {
      "year": 2026,
      "month": 1,
      "key": "2026-01",
      "count": 2
    },
    {
      "year": 2025,
      "month": 12,
      "key": "2025-12",
      "count": 5
    }
  ]
}
```

`GET /api/timeline/month?month=2026-07` 返回该月文章：

```json
{
  "month": "2026-07",
  "articles": []
}
```

月份识别规则：

- 使用文章 manifest 中已有的 `article.date`。
- 若 `date` 是 `YYYY-MM-DD`，取前 7 位。
- 若未来支持更复杂日期格式，应先在 `articleMetaService` 中统一规范化，Timeline 不做额外猜测。

后端实现位置：

- 在 `server/index.js` 的 `handleApi()` 中新增两个 pathname 分支。
- 可在 `ManifestService` 中新增方法：
  - `getTimelineMonths()`
  - `findArticlesByMonth(month)`

示例逻辑：

```js
function articleMonthKey(article) {
  const match = String(article.date || '').match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
}
```

`getTimelineMonths()`：

- 遍历 `root.latest`。
- 按 `YYYY-MM` 聚合文章数量。
- 按年月倒序排列。
- 只返回有文章的月份。

`findArticlesByMonth(month)`：

- 校验 `month` 必须匹配 `/^\d{4}-\d{2}$/`。
- 从 `root.latest` 过滤 `articleMonthKey(article) === month`。
- 保持 `root.latest` 原有倒序，无需二次排序。

## Timeline 数据渲染

Timeline 左侧样式目标：

```text
7
|
6
|
5
|
4
|
3
|
2
|
1
·
2026
·
12
|
11
|
10
|
9
.
.
.
·
2025
·
.
.
.
```

实现原则：

- 只渲染有文章的月份数字。
- 月份之间使用竖向虚线连接。
- 每个月份之间的上下间隔是固定月份单位长度。
- 如果两个有文章月份之间缺少若干个月，不渲染缺失月份数字，但连接线高度要补足缺失月份对应的间隔。
- 年份节点使用 `· 年份 ·` 的视觉节奏，年份本身居中/左对齐需与月份数字形成稳定轴线。

推荐 DOM：

```html
<div class="timeline-nav" aria-label="Timeline">
  <button class="timeline-year" type="button" disabled>
    <span class="timeline-dot" aria-hidden="true">·</span>
    <span class="timeline-year__text">2026</span>
    <span class="timeline-dot" aria-hidden="true">·</span>
  </button>

  <button class="timeline-month is-active" type="button" data-month="2026-07">
    <span class="timeline-month__label">7</span>
  </button>

  <span class="timeline-connector" style="--month-gap-count: 1"></span>

  <button class="timeline-month" type="button" data-month="2026-06">
    <span class="timeline-month__label">6</span>
  </button>
</div>
```

建议渲染顺序：

- 整体按时间倒序。
- 同一年内月份从大到小，例如 `7, 6, 5...1`。
- 年份节点放在该年份最后一个月份之后，即 `1 · 2026 · 12` 这样的阅读顺序与需求示例一致。
- 如果某年只有部分月份有文章，也仍然按月份实际位置计算间隔。

## 月份间距算法

核心是计算两个相邻有文章月份之间跨过了多少自然月份。

```js
function monthIndex(key) {
  const [year, month] = key.split('-').map(Number);
  return year * 12 + (month - 1);
}

function monthGapCount(currentKey, nextKey) {
  return Math.max(1, monthIndex(currentKey) - monthIndex(nextKey));
}
```

示例：

- `2026-07` 到 `2026-06`：差值 `1`，连接线高度为 `1` 个单位。
- `2026-07` 到 `2026-04`：差值 `3`，中间缺 `6`、`5`，连接线高度为 `3` 个单位。
- `2026-01` 到 `2025-12`：差值 `1`，跨年但间距仍为 `1` 个单位。

CSS 中定义固定单位：

```css
.timeline-connector {
  --timeline-month-step: 28px;
  display: block;
  height: calc(var(--timeline-month-step) * var(--month-gap-count));
  border-left: 1px dashed var(--line-strong);
}
```

如果需要显示示例里的多个 `.` 视觉，不建议实际渲染多个文本点；用虚线高度表达缺失月份更稳定。

## 前端函数拆分

建议新增函数：

```js
async function loadTimeline() {}
function renderSidebarPanel() {}
function renderSidebarTabs() {}
function renderTimelineNav() {}
function renderTimelineYearGroup(year, months) {}
async function renderTimelineMonth(month, renderId, options = {}) {}
function timelineRouteFromMonth(month) {}
function normalizeMonthKey(value) {}
function monthLabel(monthKey) {}
function timelineEyebrow(monthKey) {}
function timelineTitle(monthKey) {}
```

`loadTimeline()`：

- 调用 `/api/timeline`。
- 写入 `state.timeline`。
- 可在 `boot()` 中与 `loadTree()` 顺序执行，也可首次切换 Timeline 时懒加载。
- 推荐懒加载：减少首页首次加载负担；但点击 Timeline 后需要显示 loading。

`renderSidebarPanel()`：

- 如果 `state.sidebarMode === 'timeline'` 或当前路由是 `timeline`，渲染 `renderTimelineNav()`。
- 否则渲染原 `renderTree()`。
- 同时更新两个标签的 `is-active` 类。

切换逻辑：

- 点击 `Index`：
  - `state.sidebarMode = 'index'`
  - 渲染文章目录，不改变右侧当前文章列表，除非当前路由是 `timeline` 且产品希望回到 Latest。
  - 推荐：只切换左侧区域，右侧保持当前列表。
- 点击 `Timeline`：
  - `state.sidebarMode = 'timeline'`
  - 加载并渲染 Timeline，不改变右侧当前文章列表。

点击月份：

- 调用 `setRoute('timeline', monthKey)`。
- 设置 `state.sidebarMode = 'timeline'`。
- 右侧加载该月文章。

`renderTimelineMonth(month, renderId, options)`：

- `setViewMode('list')`
- `state.currentFolder = ''`
- `state.activeFolder = ''`
- `state.activeTimelineMonth = month`
- `state.lastListRoute = { type: 'timeline', month }`
- 请求 `/api/timeline/month?month=YYYY-MM`
- 调用 `renderListShell(title, eyebrow, articles, { route, steady })`

标题建议：

- `title`: `2026 · 7`
- `eyebrow`: `TIMELINE`

其中 `·` 继续使用 `renderDisplayPath` 类似的 span，不要直接写普通点号，以保证颜色一致。

## CSS 建议

新增样式块：

```css
.sidebar-tabs {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: "Fraunces", serif;
  font-size: 28px;
  font-style: italic;
  font-weight: 400;
}

.sidebar-tab {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
}

.sidebar-tab.is-active {
  color: var(--moss);
}

.sidebar-tab-separator,
.timeline-dot {
  color: var(--morandi-red);
  font-size: 1.8em;
  line-height: 1;
}

.timeline-nav {
  display: grid;
  justify-items: start;
  padding-top: 2px;
}

.timeline-month {
  min-width: 32px;
  min-height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font-family: "DM Mono", monospace;
  font-size: 14px;
}

.timeline-month:hover,
.timeline-month.is-active {
  color: var(--moss);
}

.timeline-connector {
  --timeline-month-step: 28px;
  height: calc(var(--timeline-month-step) * var(--month-gap-count));
  margin-left: 15px;
  border-left: 1px dashed var(--line-strong);
}

.timeline-year {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--forest);
  font-family: "Fraunces", serif;
  font-size: 18px;
  font-style: italic;
}
```

移动端：

- 复用现有 `body.is-index-open .sidebar` 抽屉。
- 顶部移动按钮仍可显示 `Index`；如果需要更准确，可改成打开侧栏的通用按钮，例如 `Menu`，但本次需求不强制。
- Timeline 点击月份后应关闭移动侧栏，避免遮挡右侧列表。

## 实施步骤

1. 修改 `index.html`
   - 将静态 `Index` 标题替换为 `Index · Timeline` 标签组。
   - 为两个按钮添加 `id="indexTab"`、`id="timelineTab"`。

2. 修改 `server/services/manifestService.js`
   - 新增月份 key 提取、月份聚合、按月文章查询方法。

3. 修改 `server/index.js`
   - 新增 `/api/timeline`。
   - 新增 `/api/timeline/month`。
   - 错误情况返回：
     - 非法月份：`400 { "error": "INVALID_MONTH" }`
     - 月份无文章：`200 { "month": "YYYY-MM", "articles": [] }`

4. 修改 `app.js`
   - 扩展 `state`、`els`。
   - 扩展 hash 路由函数。
   - 扩展列表缓存/滚动恢复支持 timeline。
   - 新增 Timeline 加载与渲染函数。
   - 新增标签点击事件。
   - `render()` 完成后调用统一侧栏渲染函数。

5. 修改 `style.css`
   - 新增标签组样式。
   - 新增 timeline 树状纵向样式。
   - 确认 `·` 与现有 `.meta-separator` 颜色一致。

6. 手动验证
   - 首页默认仍显示 `Index` 和目录树。
   - 点击 `Timeline` 左侧区域切换为时间线。
   - 点击 `Index` 切回目录树。
   - 选中标签颜色为 `#4f5e4a`。
   - 有文章月份才显示数字。
   - 缺失月份不显示数字，但上下间隔补足。
   - 点击月份后右侧文章列表只显示该月文章。
   - 从月份文章进入文章页，再点击 Back，回到同一月份列表。
   - 移动端侧栏打开/关闭逻辑不被破坏。

## 验收标准

- 视觉上左侧入口显示为 `Index · Timeline`，分隔点颜色与文章列表中的 `·` 一致。
- `Index` 与 `Timeline` 切换只影响左侧区域，不造成右侧列表不必要刷新。
- 当前选中标签、当前选中月份使用 `#4f5e4a`。
- Timeline 中只有有文章的月份显示数字。
- 月份之间以虚线连接，跨缺失月份时连接线高度按缺失月份数量增加。
- 点击月份后，右侧列表标题和文章内容与该月份一致。
- 原有 `Latest`、文件夹目录、文章页、Back 逻辑保持可用。

