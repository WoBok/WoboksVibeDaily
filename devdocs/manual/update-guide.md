# 网站更新说明

本文档说明服务器已经完成首次部署后，如何更新网站代码和文章内容。

每次更新前，先进入项目目录：

```bash
cd /home/admin/WoboksVibeDaily
```

## 1. 更新网站代码

如果你修改了这些内容，就属于网站代码更新：

```text
server/
scripts/
index.html
app.js
style.css
package.json
```

推荐执行：

```bash
cd /home/admin/WoboksVibeDaily
git pull
npm install
npm run build:content
sudo systemctl restart woboks-vibe-daily
```

说明：

- `git pull`：从 GitHub 拉取最新代码。
- `npm install`：安装或更新依赖。如果 `package.json` 没变，这一步通常可以省略。
- `npm run build:content`：重新生成文章 manifest。
- `sudo systemctl restart woboks-vibe-daily`：重启 Node.js 服务，让后端代码更新生效。

如果你确定依赖没有变化，可以使用简化流程：

```bash
cd /home/admin/WoboksVibeDaily
git pull
npm run build:content
sudo systemctl restart woboks-vibe-daily
```

## 2. 只更新文章

如果你只修改了 `notes/` 目录下的文章内容，就属于文章更新。

理论上，服务运行时会监听文章目录变化，`git pull` 后会自动触发 manifest 重建，然后刷新网页即可：

```bash
cd /home/admin/WoboksVibeDaily
git pull
```

不过生产环境更推荐执行下面这个稳妥流程：

```bash
cd /home/admin/WoboksVibeDaily
git pull
npm run build:content
```

这样可以确保 `notes/_manifest.json` 和各文章目录下的 `_manifest.json` 一定是最新的。

只更新文章时，通常不需要重启 Node.js 服务，也不需要 reload Nginx。执行完后直接刷新网页即可。

如果刷新后仍然看不到新文章或新排序，再重启 Node.js 服务：

```bash
sudo systemctl restart woboks-vibe-daily
```

## 3. 最稳的一键更新流程

如果你不想区分这次是改了代码还是只改了文章，可以每次都执行这一套：

```bash
cd /home/admin/WoboksVibeDaily
git pull
npm install
npm run build:content
sudo systemctl restart woboks-vibe-daily
```

这套流程最稳，适合手动部署时直接使用。

## 4. 什么时候需要 reload Nginx

一般更新网站代码或文章时，不需要 reload Nginx。

只有修改了 Nginx 配置文件时，才需要执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

例如修改了这些配置：

```text
/etc/nginx/sites-available/woboks-vibe-daily
/etc/nginx/nginx.conf
```

## 5. 推荐记法

只更新文章：

```bash
cd /home/admin/WoboksVibeDaily
git pull
npm run build:content
```

更新网站代码：

```bash
cd /home/admin/WoboksVibeDaily
git pull
npm install
npm run build:content
sudo systemctl restart woboks-vibe-daily
```

Nginx 配置没有变化时，不需要执行 `sudo systemctl reload nginx`。
