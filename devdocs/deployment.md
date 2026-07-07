# WoBok's Vibe Daily — 部署手册

> 目标：把本仓库部署到一台 Linux 远程服务器，使用 **nginx + Node API + 静态前端** 架构对外提供个人笔记站点。
>
> 对应设计：[refactor-design.md](refactor-design.md) §3 §14。

---

## 0. 架构回顾

```
Browser
  │  静态：index.html / style.css / app.js
  │  接口：/api/*
  │  内容：/content/posts/*
  ▼
nginx（监听 80/443）
  │── 静态资源            → 项目根目录
  │── /content/posts/*    → posts/
  │── /api/*              → 反代到 127.0.0.1:17321
  │── _manifest.json      → 404（禁止外部访问）
  ▼
Node.js（127.0.0.1:17321）
  │  扫描 / 监听 posts/0x*/ 下 md/html，构建 manifest，提供 API
  ▼
posts/
  ├─ _manifest.json          （根 manifest）
  ├─ 0x0 - Inbox/_manifest.json
  └─ 0x1 - Concepts/.../_manifest.json
```

- 前端（`index.html` / `app.js` / `style.css`）由 nginx 直接发出。
- Markdown 在浏览器端渲染（markdown-it + KaTeX + highlight.js + DOMPurify，走 CDN）。
- HTML 文章通过 iframe 原样加载（`/content/posts/...`）。
- Node 只负责目录树、Latest、叶子目录列表、文章原文 API，并监听文件变化自动重建 manifest。

---

## 1. 服务器前提

| 组件 | 版本要求 | 说明 |
|------|----------|------|
| OS   | 任意主流 Linux（Ubuntu 22.04+ / Debian 12+ / CentOS 等） | |
| Node.js | ≥ 18（推荐 20 LTS） | 运行后端 |
| nginx | 任意现代版本 | 静态 + 反代 |
| git  | 任意 | 拉取代码 |
| (可选) certbot | 最新 | 申请 HTTPS 证书 |

安装示例（Ubuntu / Debian）：

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# nginx
sudo apt-get install -y nginx

# certbot（HTTPS，可选）
sudo apt-get install -y certbot python3-certbot-nginx
```

---

## 2. 代码部署

选定部署目录（本文以 `/var/www/woboks-vibe-daily` 为例）：

```bash
sudo mkdir -p /var/www/woboks-vibe-daily
sudo chown -R $USER:$USER /var/www/woboks-vibe-daily

# 方式一：git 克隆
git clone <你的仓库地址> /var/www/woboks-vibe-daily

# 方式二：上传压缩包后解压到该目录
```

安装依赖（仅一个运行时依赖 `chokidar`）：

```bash
cd /var/www/woboks-vibe-daily
npm install --omit=dev
```

> 仓库已包含 `package.json`，依赖会装到 `node_modules/`。

---

## 3. 运行用户与目录权限

建议新建一个非 root 用户运行 Node：

```bash
sudo useradd -r -s /usr/sbin/nologin wvd
sudo chown -R wvd:wvd /var/www/woboks-vibe-daily
```

Node 需要在 `posts/` 下读写 `_manifest.json`，因此 `posts/` 目录必须对 `wvd` 可写（上一步已满足）。

---

## 4. Node 进程管理（systemd，推荐）

将仓库内的模板复制到 systemd 目录：

```bash
sudo cp nginx/woboks-vibe-daily.service /etc/systemd/system/
sudo nano /etc/systemd/system/woboks-vibe-daily.service
# 按文件头注释替换：User/Group、WorkingDirectory、ExecStart 的 node 路径
```

确认 `node` 路径：`which node`（常见 `/usr/bin/node` 或 `/usr/local/bin/node`）。

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now woboks-vibe-daily
sudo systemctl status woboks-vibe-daily
sudo journalctl -u woboks-vibe-daily -f   # 看实时日志
```

正常启动日志应包含：

```
[boot] building manifests...
[boot] manifests ready, starting watcher...
  WoBok's Vibe Daily server
  → http://127.0.0.1:17321
[watch] ready — watching posts/0x*/**/*.{md,markdown,html}
```

本地自测（在服务器上）：

```bash
curl http://127.0.0.1:17321/api/tree
curl http://127.0.0.1:17321/api/latest
```

> 备选：使用 pm2 —— `sudo npm i -g pm2`、`pm2 start server/index.js --name wvd`、`pm2 save`、`pm2 startup`。个人站点二选一即可，systemd 更轻量。

---

## 5. nginx 配置

复制模板并启用：

```bash
sudo cp nginx/wvd.prod.conf /etc/nginx/sites-available/woboks-vibe-daily
sudo nano /etc/nginx/sites-available/woboks-vibe-daily
# 替换：server_name、root、alias 中的路径与端口

sudo ln -s /etc/nginx/sites-available/woboks-vibe-daily /etc/nginx/sites-enabled/
sudo nginx -t
sudo nginx -s reload
```

模板（`nginx/wvd.prod.conf`）要点：

- `root` 指向项目根，发出 `index.html / app.js / style.css`。
- `location /api/` 反代到 `http://127.0.0.1:17321`，并强制 `no-store`。
- `location /content/posts/` 用 `alias` 映射到 `posts/`，HTML 文章 iframe 走这里。
- `location ~ _manifest\.json$ { return 404; }` 禁止外部读取 manifest。
- `location /` 用 `try_files ... /index.html` 做 SPA 兜底。

> 如果你的 nginx 使用 `conf.d` 而非 `sites-enabled`，把文件放到 `/etc/nginx/conf.d/woboks-vibe-daily.conf` 即可，内容不变。

---

## 6. HTTPS（强烈建议）

```bash
sudo certbot --nginx -d example.com -d www.example.com
```

certbot 会自动改写 nginx 配置、签发证书、设置 80→443 跳转与自动续期。

---

## 7. 防火墙

只对外暴露 80/443，Node 端口 17321 保持仅本机访问：

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
# 不要 allow 17321
```

确认 17321 只监听 127.0.0.1（systemd 单元里 `WVD_HOST=127.0.0.1` 已保证）。

---

## 8. 验收清单

部署后逐项确认：

- [ ] 访问 `https://example.com/`，首页右侧显示 **Latest**，列出全站文章。
- [ ] 左侧目录树为墨绿圆点；点击有子目录的节点可展开/收起；点击叶子目录加载其文章列表。
- [ ] 选中路径的圆点变浅绿。
- [ ] 文章列表项含日期、标题、总结（无阅读时间）。
- [ ] 打开 Markdown 文章：显示「目录路径 · 时间 / 标题 / 正文」，LaTeX、代码块、表格正常。
- [ ] 打开 HTML 文章：iframe 原样显示，保留原页面样式与交互。
- [ ] 文章页左侧大纲、右侧引用 Overlay 存在；鼠标移入展开，邻近项有 Dock 缩放动画；点击大纲不刷新页面。
- [ ] 顶栏右侧文章页显示 **Back**，点击返回来源列表。
- [ ] 直接访问 `https://example.com/content/posts/0x0%20-%20Inbox/_manifest.json` 返回 **404**。
- [ ] 在 `posts/` 下新增/修改/删除一个 md 或 html，几秒后 Latest 与对应目录列表自动更新（无需重启）。

---

## 9. 发布与更新流程

**发布新文章**：直接在服务器 `posts/<0x 分类>/` 下新增 `.md` 或 `.html` 文件（记得写 frontmatter / meta 的 `summary`）。chokidar 监听到变化后会自动重建对应叶子 manifest 与根 manifest，前端刷新即可见。

**更新代码**（前端 / 后端）：

```bash
cd /var/www/woboks-vibe-daily
git pull
npm install --omit=dev        # 依赖变化时
sudo systemctl restart woboks-vibe-daily
sudo nginx -t && sudo nginx -s reload   # nginx 配置变化时
```

> 仅改 `posts/` 下的文章不需要重启 Node；改 `app.js / style.css / index.html` 只需浏览器刷新（已设 no-cache）；改 `server/` 代码需 `systemctl restart`。

---

## 10. 内容规范速记

- 分类目录必须以 `0x` 开头，建议 `0xN - Name` 格式；非 `0x` 目录被忽略。
- 只有叶子目录（无 `0x` 子目录）中的文章会被索引；非叶子目录里的文件被忽略。
- 支持扩展名：`.md` / `.markdown` / `.html`。
- Markdown 用 frontmatter：`title` / `date` / `summary` / `category` / `tags`。
- HTML 用 `<meta name="title|date|summary|category" content="...">`；`content` 含双引号需转义为 `&quot;`。
- `summary` 是文章总结，建议手写、保留关键信息以便回忆。

---

## 11. 常见问题排查

| 现象 | 排查 |
|------|------|
| 首页空白 / 报启动失败 | `journalctl -u woboks-vibe-daily -n 50`；确认 `posts/` 存在且可写；确认端口未被占用 |
| `/api/*` 502 | Node 未运行或端口不对；`systemctl status woboks-vibe-daily`；检查 nginx `proxy_pass` 端口 |
| 文章打不开 / 404 | 路径含空格或中文需 URL 编码；确认文件在叶子目录下；确认扩展名被支持 |
| HTML 文章样式丢失 | iframe 走 `/content/posts/`，确认 nginx `alias` 路径正确、末尾带 `/` |
| 改了文章前端不更新 | 浏览器缓存；`/api` 已 no-store，强刷（Ctrl+F5）；确认 chokidar 在运行（看日志 `[watch] rebuilt ...`） |
| `_manifest.json` 被外部读到 | nginx 未加 `location ~ _manifest\.json$` 规则；重启 nginx |
| manifest 写入冲突 / 残留 tmp | Node 已用「临时文件 + rename」原子写并串行化；若仍残留 `.tmp`，可手动删除，重启服务后会重建 |

---

## 12. 本地开发与远程的一致性

本地（Windows）与远程（Linux）使用同一份代码，差异仅在：

- 本地测试用 `nginx/wvd.local.conf`（Windows 绝对路径、8080 端口）。
- 远程生产用 `nginx/wvd.prod.conf`（Linux 路径、80/443）。
- 端口/主机通过环境变量 `WVD_PORT` / `WVD_HOST` 覆盖，无需改代码。

本地快速运行（不依赖 nginx）：

```bash
node server/index.js
# 打开 http://127.0.0.1:17321
```

本地经 nginx 运行：

```bash
node server/index.js                         # 终端 1
nginx -c "<项目绝对路径>/nginx/wvd.local.conf"  # 终端 2
# 打开 http://127.0.0.1:8080
# 停止 nginx：nginx -c "<同上>" -s stop
```
