# 网站更新说明

本文档说明服务器已经完成首次部署后，如何更新网站代码和文章内容。

> 索引（manifest）完全存放在内存中：服务启动时扫描一次 `notes/`，运行期间监听 `notes/` 目录，文件变化后约 0.5 秒自动增量重扫。**不再有 `_manifest.json` 生成文件，也不再需要任何构建命令。**

每次更新前，先进入项目目录：

```bash
cd /home/admin/WoboksVibeDaily
```

## 1. 更新网站代码

如果你修改了这些内容，就属于网站代码更新：

```text
server/
index.html
app.js
style.css
package.json
```

推荐执行：

```bash
cd /home/admin/WoboksVibeDaily
git pull
sudo systemctl restart woboks-vibe-daily
```

说明：

- `git pull`：从 GitHub 拉取最新代码。
- `sudo systemctl restart woboks-vibe-daily`：重启 Node.js 服务，让后端代码更新生效（重启时会自动重新扫描文章索引）。
- 项目零第三方依赖，通常无需 `npm install`；只有 `package.json` 变化时才考虑执行。

## 2. 只更新文章

如果你只修改了 `notes/` 目录下的文章内容，只需要：

```bash
cd /home/admin/WoboksVibeDaily
git pull
```

服务运行时会监听 `notes/` 目录，`git pull` 落盘后自动重建内存索引，刷新网页即可看到新内容。不需要重启 Node.js 服务，也不需要 reload Nginx。

> 安全提示：HTML 笔记在站内以同源方式渲染，其中的脚本会被执行——请把 HTML 笔记视为可执行代码，只放入自己编写或已审查过的内容。命名不符合 `0x` 分类规则的目录和文件会被索引忽略（不会被删除，也不会出现在网站上）。

如果服务是以 `WATCH=0`（关闭监听）方式运行的，可以任选其一让索引生效：

```bash
curl -X POST http://127.0.0.1:55555/api/rebuild
# 或
sudo systemctl restart woboks-vibe-daily
```

## 3. 最稳的一键更新流程

如果你不想区分这次是改了代码还是只改了文章，可以每次都执行这一套：

```bash
cd /home/admin/WoboksVibeDaily
git pull
sudo systemctl restart woboks-vibe-daily
```

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
```

更新网站代码：

```bash
cd /home/admin/WoboksVibeDaily
git pull
sudo systemctl restart woboks-vibe-daily
```

Nginx 配置没有变化时，不需要执行 `sudo systemctl reload nginx`。
