# Woboks Vibe Daily 部署文档

本文档适用于将本站部署到一台已经安装了 Nginx 和 Node.js 的 Linux 服务器上。

项目服务端入口是 `server/index.js`，默认监听：

- Host: `127.0.0.1`
- Port: `55555`

推荐部署方式是：Node.js 进程只监听服务器本机 `127.0.0.1:55555`，由 Nginx 对外提供 HTTP/HTTPS 访问并反向代理到该端口。

## 1. 服务器要求

- Linux 服务器一台
- Nginx 已安装
- Node.js `>= 22`
- Git 已安装
- 一个普通部署用户，例如 `deploy`

检查版本：

```bash
node -v
npm -v
nginx -v
```

如果 Node.js 版本低于 22，请先升级 Node.js。

## 2. 上传或拉取项目

以下示例把项目放在 `/var/www/woboks-vibe-daily`：

```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
cd /var/www
git clone <你的仓库地址> woboks-vibe-daily
cd /var/www/woboks-vibe-daily
```

如果你不是通过 Git 部署，也可以直接把本地项目目录上传到：

```text
/var/www/woboks-vibe-daily
```

需要确保这些文件和目录存在：

```text
index.html
app.js
style.css
package.json
server/
scripts/
notes/
```

## 3. 安装依赖并生成内容索引

当前项目没有外部 npm 依赖，但仍建议在项目目录执行一次安装命令，方便后续扩展：

```bash
cd /var/www/woboks-vibe-daily
npm install
```

生成或刷新文章索引：

```bash
npm run build:content
```

该命令会生成 `notes/_manifest.json` 以及各叶子目录下的 `_manifest.json`。

## 4. 使用 systemd 托管 Node.js 服务

创建 systemd 服务文件：

```bash
sudo nano /etc/systemd/system/woboks-vibe-daily.service
```

写入以下内容：

```ini
[Unit]
Description=Woboks Vibe Daily Node Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/woboks-vibe-daily
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=55555

[Install]
WantedBy=multi-user.target
```

如果你的 `npm` 不在 `/usr/bin/npm`，用下面命令查看真实路径：

```bash
which npm
```

然后把 `ExecStart=/usr/bin/npm run start` 里的路径替换成实际输出。

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable woboks-vibe-daily
sudo systemctl start woboks-vibe-daily
```

查看状态：

```bash
sudo systemctl status woboks-vibe-daily
```

查看日志：

```bash
journalctl -u woboks-vibe-daily -f
```

本机检查 Node 服务是否正常：

```bash
curl http://127.0.0.1:55555/
curl http://127.0.0.1:55555/api/tree
```

## 5. 配置 Nginx 反向代理

创建 Nginx 配置：

```bash
sudo nano /etc/nginx/sites-available/woboks-vibe-daily
```

如果你希望网站通过域名的 80 端口访问，写入：

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

把 `example.com` 替换成你的真实域名。

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/woboks-vibe-daily /etc/nginx/sites-enabled/woboks-vibe-daily
sudo nginx -t
sudo systemctl reload nginx
```

访问：

```text
http://example.com/
```

## 6. 如果必须让外部访问 55555 端口

如果你的需求是浏览器直接访问 `http://example.com:55555/`，有两种方式，二选一即可。

### 方式 A：Node.js 直接对外监听 55555

修改 systemd 服务中的环境变量：

```ini
Environment=HOST=0.0.0.0
Environment=PORT=55555
```

然后重启服务：

```bash
sudo systemctl daemon-reload
sudo systemctl restart woboks-vibe-daily
```

同时需要在服务器安全组或防火墙放行 TCP `55555`。

这种方式不经过 Nginx，配置简单，但不利于统一 HTTPS、访问日志和安全控制。

### 方式 B：Nginx 对外监听 55555，再转发到 Node

这种方式下，Node 不能也监听外部 `0.0.0.0:55555`，否则会和 Nginx 抢端口。

建议把 Node 改到本机另一个端口，例如 `55556`：

```ini
Environment=HOST=127.0.0.1
Environment=PORT=55556
```

然后 Nginx 配置：

```nginx
server {
    listen 55555;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:55556;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

重载服务：

```bash
sudo systemctl daemon-reload
sudo systemctl restart woboks-vibe-daily
sudo nginx -t
sudo systemctl reload nginx
```

访问：

```text
http://example.com:55555/
```

## 7. 防火墙或云服务器安全组

如果使用推荐方式，即 Nginx 监听 80/443，通常只需要开放：

- TCP 80
- TCP 443

如果要外部直接访问 `55555`，还需要开放：

- TCP 55555

Ubuntu UFW 示例：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 55555/tcp
sudo ufw status
```

## 8. HTTPS 配置

如果你有域名，推荐使用 Certbot：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d example.com
```

完成后检查自动续期：

```bash
sudo certbot renew --dry-run
```

## 9. 更新部署流程

后续更新网站时：

```bash
cd /var/www/woboks-vibe-daily
git pull
npm install
npm run build:content
sudo systemctl restart woboks-vibe-daily
sudo systemctl reload nginx
```

如果只是修改 `notes/` 内容，并且服务保持默认监听行为，Node 服务会启动文件监听，通常会自动刷新索引。稳妥起见，线上更新后仍建议执行：

```bash
npm run build:content
sudo systemctl restart woboks-vibe-daily
```

## 10. 常见问题排查

### 端口是否被占用

```bash
sudo ss -lntp | grep 55555
```

### Node 服务启动失败

```bash
sudo systemctl status woboks-vibe-daily
journalctl -u woboks-vibe-daily -n 100 --no-pager
```

重点检查：

- Node.js 是否为 22 或更高版本
- `WorkingDirectory` 是否正确
- `ExecStart` 中的 `npm` 路径是否正确
- 项目目录下是否存在 `notes/`

### Nginx 返回 502

先检查 Node 服务：

```bash
curl http://127.0.0.1:55555/
sudo systemctl status woboks-vibe-daily
```

如果 Node 正常，再检查 Nginx：

```bash
sudo nginx -t
sudo tail -n 100 /var/log/nginx/error.log
```

### API 可以访问但文章打不开

重新生成内容索引：

```bash
cd /var/www/woboks-vibe-daily
npm run build:content
sudo systemctl restart woboks-vibe-daily
```

### 修改了 Nginx 配置但不生效

```bash
sudo nginx -t
sudo systemctl reload nginx
```

如果 `nginx -t` 报错，先按报错行号修复配置，再 reload。

## 11. 推荐最终结构

推荐线上状态如下：

```text
Browser
  -> Nginx: 80/443
  -> Node.js: 127.0.0.1:55555
  -> /var/www/woboks-vibe-daily
  -> notes/
```

这种方式安全、稳定，也方便之后添加 HTTPS、访问日志和缓存策略。
