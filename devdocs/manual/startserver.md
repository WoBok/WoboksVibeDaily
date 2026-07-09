cd E:\WebProrjects\WoboksVibeDaily
npm start        # 等价于 node server/index.js

启动后访问 http://127.0.0.1:55555。启动时自动扫描一次 notes/ 建立内存索引，运行期间监听 notes/ 目录——你新增、修改、删除文章后约 0.5 秒自动重扫，刷新浏览器即可看到变化，不需要重启服务，也不需要跑任何命令。

跑测试用 npm test（14 个单测）。

与之前的对比

┌──────────────────┬───────────────────────────┬─────────────────────────────────────┐
│       场景       │           之前            │                现在                 │
├──────────────────┼───────────────────────────┼─────────────────────────────────────┤
│ 本地启动         │ npm run build:content     │ 直接 npm start                      │
│                  │ 生成 manifest → npm start │                                     │
├──────────────────┼───────────────────────────┼─────────────────────────────────────┤
│ 本地改文章       │ 需重新 build 或依赖 watch │ 保存文件即可，自动进内存索引        │
│                  │  写盘 manifest            │                                     │
├──────────────────┼───────────────────────────┼─────────────────────────────────────┤
│ 服务器只更新文章 │ git pull + 构建 manifest  │ 只需 git pull，watch 自动重扫       │
├──────────────────┼───────────────────────────┼─────────────────────────────────────┤
│ 服务器更新代码   │ git pull + build +        │ git pull + sudo systemctl restart   │
│                  │ restart                   │ woboks-vibe-daily                   │
├──────────────────┼───────────────────────────┼─────────────────────────────────────┤
│ manifest 文件    │ notes/ 下有 10 个         │ 完全没有，索引纯内存                │
│                  │ _manifest.json            │                                     │
└──────────────────┴───────────────────────────┴─────────────────────────────────────┘

服务器部署/更新（详见 devdocs/manual/update-guide.md）

只改了文章（notes/ 目录）：

cd /home/admin/WoboksVibeDaily
git pull

到此为止——运行中的服务监听到文件落盘后自动重建索引。

改了代码（server/、app.js、style.css、index.html、package.json）：

cd /home/admin/WoboksVibeDaily
git pull
sudo systemctl restart woboks-vibe-daily

不想区分的话，每次都执行上面这套（pull + restart）也完全没问题。

两个补充说明：

- 项目零第三方依赖，npm install 永远不需要（除非哪天 package.json 引入了依赖）。
- 如果服务是以 WATCH=0 环境变量运行的（关闭了文件监听），改完文章后需手动触发一次：curl -X POST http://127.0.0.1:55555/api/rebuild，或者直接重启服务。默认部署不用管这条。

Nginx 只有在改它自己的配置时才需要 sudo nginx -t && sudo systemctl reload nginx，日常更新代码和文章都不涉及它。