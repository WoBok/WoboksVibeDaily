本地手动启动：
    cd E:\WebProrjects\WoboksVibeDaily
    npm run dev

然后访问：
    http://127.0.0.1:55555/
    
关闭服务：
    Ctrl + C


如果之前的服务还在后台跑着，先查端口占用：
Get-NetTCPConnection -LocalPort 17321,55555 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess
执行：Stop-Process -Id [PID]