# WoBok's Vibe Daily 部署手册

日期：2026-07-06  
适用版本：Node.js 后端扫描 / API / watcher 重构版

## 1. 本地验证结果

本机已完成以下验证：

- `npm run build:content` 可清理 `posts/` 下非 `0x` 测试目录，并生成 `posts/_manifest.json` 与叶子目录 `_manifest.json`。
- 当前有效文章数：10。
- Node 服务已启动：`http://127.0.0.1:17321`。
- API smoke test 通过：`/api/tree`、`/api/latest`、`/api/folder`、`/api/article`、`/content/posts/*`。
- 浏览器验证通过：首页 Latest、Markdown 文章、HTML iframe 文章均可打开，控制台无错误。
- 本机已通过 winget 安装 nginx：`nginx/1.31.2`。当前 shell 可能需要重启后才能直接使用 `nginx` 命令。

## 2. 服务器环境

建议远程服务器：

- Ubuntu 22.04 / 24.04 LTS 或 Debian 12。
- Node.js 22 LTS 或更新版本。
- nginx 1.24 或更新版本。
- 一个普通部署用户，例如 `deploy`。

示例安装：

```bash
sudo apt update
sudo apt install -y nginx git

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node --version
npm --version
nginx -v
```

## 3. 目录规划

推荐部署到：

```text
/var/www/woboks-vibe-daily/
  index.html
  app.js
  style.css
  package.json
  server/
  scripts/
  posts/
  devdocs/
```

首次部署：

```bash
sudo mkdir -p /var/www/woboks-vibe-daily
sudo chown -R deploy:deploy /var/www/woboks-vibe-daily

cd /var/www/woboks-vibe-daily
git clone <your-repo-url> .
npm run build:content
```

当前项目没有第三方 npm 依赖，不需要 `npm install`。如果后续引入依赖，再执行 `npm ci`。

## 4. Node 进程

推荐先用 systemd。

创建服务文件：

```bash
sudo nano /etc/systemd/system/woboks-vibe-daily.service
```

内容：

```ini
[Unit]
Description=WoBok's Vibe Daily Node API
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/var/www/woboks-vibe-daily
Environment=HOST=127.0.0.1
Environment=PORT=17321
Environment=WATCH=1
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now woboks-vibe-daily
sudo systemctl status woboks-vibe-daily
```

查看日志：

```bash
journalctl -u woboks-vibe-daily -f
```

## 5. nginx 配置

创建站点配置：

```bash
sudo nano /etc/nginx/sites-available/woboks-vibe-daily
```

示例：

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
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-store";
  }

  location /content/posts/ {
    alias /var/www/woboks-vibe-daily/posts/;
    try_files $uri =404;
    etag on;
    add_header Cache-Control "no-cache";
  }

  location ~ _manifest\.json$ {
    return 404;
  }

  location = /index.html {
    add_header Cache-Control "no-cache";
  }

  location ~* \.(css|js)$ {
    add_header Cache-Control "no-cache";
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/woboks-vibe-daily /etc/nginx/sites-enabled/woboks-vibe-daily
sudo nginx -t
sudo systemctl reload nginx
```

## 6. HTTPS

使用 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com
```

续期通常由 systemd timer 自动处理：

```bash
systemctl list-timers | grep certbot
```

## 7. 日常更新流程

```bash
cd /var/www/woboks-vibe-daily
git pull
npm run build:content
sudo systemctl restart woboks-vibe-daily
sudo nginx -t
sudo systemctl reload nginx
```

新增文章时：

- 放入 `posts/0x*` 分类目录。
- 只有叶子目录的 `.md` / `.markdown` / `.html` 会展示。
- Markdown 补 frontmatter，HTML 补 meta。
- `summary` 写文章总结，便于回忆内容。

如果 Node 服务正在运行，文件变化会由 watcher 自动重建 manifest；部署更新时仍建议手动跑一次 `npm run build:content`。

## 8. 缓存策略

当前实现：

- `/api/*`：Node 返回 `Cache-Control: no-store`。
- `/content/posts/*`：Node 与 nginx 均建议 `no-cache`，并保留 `ETag` / `Last-Modified`。
- HTML iframe URL 会追加 `?v=mtimeMs`，文件变化后浏览器会拿到新 URL。
- `index.html`、`app.js`、`style.css` 由于没有构建 hash，建议暂时 `no-cache`。

后续如果引入构建工具和文件 hash，可把 `app.[hash].js`、`style.[hash].css` 改为长缓存。

## 9. 安全与权限

- Node 只监听 `127.0.0.1:17321`，外部流量由 nginx 进入。
- nginx 禁止直接访问 `_manifest.json`。
- API 会校验路径必须在 `posts/` 下，并且分类目录必须以 `0x` 开头。
- 不要把私密草稿放在 `posts/0x*` 叶子目录内。
- 如果需要草稿区，建议放在 `drafts/`，不要放入 `posts/`。

## 10. 排障

检查 Node：

```bash
sudo systemctl status woboks-vibe-daily
journalctl -u woboks-vibe-daily -n 80
```

检查 nginx：

```bash
sudo nginx -t
sudo tail -n 80 /var/log/nginx/error.log
```

检查 API：

```bash
curl http://127.0.0.1:17321/api/tree
curl http://127.0.0.1:17321/api/latest
```

常见问题：

- 页面有列表但文章打不开：检查 `/api/article?path=...` 是否返回 200。
- HTML iframe 旧内容未更新：确认文章文件 mtime 改变，iframe URL 是否带新的 `?v=`。
- 新目录不显示：确认每一级分类目录都以 `0x` 开头。
- 文件在非叶子目录中：按规则会被忽略，不会展示。
- nginx 404：检查 `location /content/posts/` 的 `alias` 是否以 `/posts/` 结尾。
