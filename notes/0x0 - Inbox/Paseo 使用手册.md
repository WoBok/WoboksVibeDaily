---
title: "Paseo 使用手册"
date: "2026-09-29"
summary: "涵盖 Paseo 的安装配置、工作区与 Worktree 管理、多 Agent 编排、定时任务、浏览器自动化、远程访问、Provider 扩展及常见问题排查。"
category: "Inbox"
tags:
  - "Paseo"
  - "多 Agent 编排"
  - "Worktree"
  - "定时任务"
  - "远程访问"
  - "使用手册"
---

## 1. Paseo 是什么

Paseo 是一个**自托管的编码 Agent 管理平台**。它自己不带 AI，而是启动并托管你电脑上已经装好、已经登录的 Agent CLI（Claude Code、Codex、OpenCode、Copilot、Gemini 等 30 多种），再在上面提供统一的界面、多 Agent 编排、隔离的工作目录、定时任务和远程访问。

```
 手机 / 桌面 / 网页 / CLI / SDK            ← 客户端（任意多个）
            │  WebSocket（本机直连 / E2E 加密中继 / Tailscale / SSH）
            ▼
     Paseo Daemon（守护进程，默认 127.0.0.1:6767）
            │  以子进程方式运行
            ▼
   claude / codex / opencode …（你自己安装的 CLI，用你自己的账号）
```

- **代码不离开你的机器**：模型调用走各 CLI 自己的账号，Paseo 不做代理，也没有遥测。
- **不另外收费**：Claude Code 走你的 Claude 套餐额度，Codex 走 ChatGPT 套餐或 API Key。
- **它不是什么**：不是托管的 Agent，不是 IDE，也不是模型提供商。
- 开源协议 Apache-2.0，桌面端自带 daemon，打开就能用。

## 2. 核心概念

| 概念 | 含义 |
|---|---|
| **Host / Daemon** | 实际运行 Agent 的那台机器上的守护进程。一个客户端可以同时连接多个 Host |
| **Provider** | 某一种 Agent CLI（claude、codex……）。分两类：**原生支持**（Claude Code / Codex / OpenCode / Pi）和 **ACP 目录**（一键安装的其余 30 多种） |
| **Project** | 一个目录或 Git 仓库，显示在侧边栏最上层 |
| **Workspace** | **任务的容器**。有自己的工作目录，里面同时开多个 Session。Paseo 的组织单位是工作区，而不是聊天 |
| **Session** | 工作区里的一个标签页：Agent、终端、浏览器、Diff |
| **Isolation** | 工作区的隔离方式：`Local` 直接用现有目录；`Worktree` 新建独立的 git worktree 和分支 |
| **Subagent** | 由某个 Agent 派生出来的子 Agent，归属于父 Agent |
| **Profile** | 保存好的一组"Provider + 模型 + 模式 + 思考强度"，附带"何时使用"说明 |
| **Schedule / Heartbeat** | Schedule 按 cron **每次新建一个 Agent** 执行；Heartbeat 定时向**同一个 Agent** 发送提示，让它继续干活 |

层级关系：`Project → Workspace → Session（Agent / Terminal / Browser / Diff）`

## 3. 安装与首次配置

1. **安装桌面端**：从 https://paseo.sh/download 下载，打开即可，daemon 会自动启动。
2. **安装至少一个 Provider CLI 并登录**，例如 `claude`、`codex login`。Paseo 只负责运行它们。
3. **推荐安装并登录 `gh`（GitHub CLI）**。PR 相关的 worktree 和部分编排功能依赖它。
4. **检查 Provider**：打开 `Settings → 你的 Host → Providers`，看是否可用。显示 Not installed 时见第 13 节。
5. **（可选）打开 Agent 工具**：`Settings → 你的 Host → Agents → Enable Paseo tools`。打开后 Agent 才能调用 Paseo 去开子 Agent、建工作区、建定时任务。**只对之后新建或重新加载的 Agent 生效。**
6. **（可选）配对手机**：`Settings → 你的 Host → Pair a device`，见第 9 节。

> **Windows 注意**：Paseo 直接沿用它启动时的环境变量，不会读取 login shell。在新开的终端里能运行的命令，重启 Paseo 后才能被它找到。

## 4. 日常工作流（桌面端）

1. **添加项目**：左侧栏 **Add project**，可以选本地目录、从 GitHub 克隆，或新建目录。
2. **建工作区**：点项目旁的 **New workspace**。
   - Isolation 选 `Local`（直接改当前目录）或 `New worktree`（独立分支，并行任务互不干扰）。
   - Base 分支建议选 **`origin/main`** 而不是 `main`。Paseo 会在后台 fetch 远端分支，本地 `main` 可能已经过时。
   - 也可以直接把一个 **GitHub PR** 开成工作区（checkout-pr）。
3. **在工作区里开标签**：
   - **New agent**：在模型选择器里选 Provider、模型、模式、思考强度，或直接选一个 **Profile**。
   - **New terminal** / **New browser tab**。标签页可以左右或上下分屏。
   - **Import session**：导入你在外部终端里开过的 Agent 会话。
4. **对话中的操作**：
   - Agent 在运行时发的新消息会**排队**。
   - 可以随时中断当前回合。
   - 可以切换模式，例如 plan / bypass，具体选项取决于 Provider。
   - 权限请求在界面里批准或拒绝。
5. **审查**：右侧 Explorer 里看文件和 Diff；也可以再开一个 Agent 做独立审查。
6. **收尾**：合并后，工作区菜单 → **Archive workspace**。最后一个引用该 worktree 的工作区被归档后，Paseo 会先运行 teardown，再删除 worktree 目录。

> 右键 Agent 标签 → **Copy agent id**，可以拿到 Agent ID，用于 CLI 或 Agent 之间互相发消息。

## 5. Worktree 与 `paseo.json`

Worktree 默认放在 `~/.paseo/worktrees/<源路径哈希>/<slug>/`，可以用 `config.json` 里的 `worktrees.root` 修改位置。

在**仓库根目录**放一个 `paseo.json`。Paseo 读取的是**所选基底分支上已提交的版本**，所以改完要先 commit。

```json
{
  "worktree": {
    "setup": "npm ci\ncp \"$PASEO_SOURCE_CHECKOUT_PATH/.env\" .env",
    "teardown": "npm run db:drop || true",
    "terminals": [{ "name": "logs", "command": "tail -f dev.log" }]
  },
  "scripts": {
    "test": { "command": "npm test" },
    "web":  { "type": "service", "command": "npm run dev -- --port $PASEO_PORT" },
    "api":  { "type": "service", "command": "npm run api -- --port $PASEO_PORT" }
  }
}
```

| 字段 | 作用 |
|---|---|
| `setup` | worktree 创建后运行一次。新 worktree 里没有依赖，也没有 `.env` 这类被忽略的文件，需要在这里安装和复制 |
| `teardown` | 归档时、删除目录前运行 |
| `terminals` | 创建 worktree 时自动打开的终端 |
| `scripts` | 可以在界面里一键运行的命名命令 |
| `type: "service"` | 常驻服务。Paseo 负责托管进程、分配端口、做反向代理 |

**服务要点**：
- 一定要监听 `$PASEO_PORT`，不要写死端口。这样每个 worktree 拿到不同端口，同一个服务的多份副本可以同时运行。
- 访问地址是 `http://<脚本名>--<分支>--<项目>.localhost:6767`（默认分支会省略分支段）。
- 服务之间通过 `$PASEO_SERVICE_<NAME>_URL` 互相找到对方，例如前端连 `$PASEO_SERVICE_API_URL`。
- 所有脚本都能用这些环境变量：`$PASEO_SOURCE_CHECKOUT_PATH`（原仓库根目录）、`$PASEO_WORKTREE_PATH`、`$PASEO_BRANCH_NAME`。

`paseo.json` 还可以用 `metadataGeneration` 定制自动生成的标题、分支名、commit message 和 PR 描述的风格：

```json
{ "metadataGeneration": { "commitMessage": { "instructions": "Follow Conventional Commits." } } }
```

## 6. 多 Agent 编排

**前提**：已打开 `Enable Paseo tools`；或者 Agent 有 shell 权限，可以直接用 `paseo` CLI。

打开后，**直接用自然语言交代任务**，主 Agent 会自己调用工具。常用说法：

| 场景 | 可以这样说 |
|---|---|
| 分派给别的模型 | "查看我的 Paseo profiles，选一个做实现，建一个 worktree 工作区，让子 agent 在那里改 parser 并跑测试后汇报" |
| 并行调研 | "在当前工作区建 3 个子 agent，分别追请求链路、看测试、找相关回归，不要改文件，都回来后汇总" |
| 并行修改不冲突 | "两个 issue 分给两个子 agent，各自从 main 建独立 worktree，完成后汇总两个 diff" |
| 实现后审查 | "先让实现 agent 在 worktree 里改，完成后再开一个独立 reviewer 检查正确性、缺失测试、多余复杂度" |
| Agent 之间互发消息 | "用 Paseo 把这段话发给 agent `<ID>`：……" |
| 管理与调度 | "汇总各子 agent 进度，标出卡住的"；"取消 UI worker 当前回合，但保留它" |

- **子 Agent 在哪里看**：输入框附近的 **Subagents** 轨道，点开可以跟进对话。子 Agent 完成后会通知主 Agent。
- **转为独立 Agent**：想让子 Agent 脱离父 Agent，可以在界面里 detach，或运行 `paseo agent detach <id>`。

**Agent Profiles**（`Settings → Host → Agents → Agent profiles → New profile`）：
- 建几个分工明确的 Profile，例如：
  - **UI work**：组件、布局、样式
  - **Planning**：架构、根因分析、方案比较
  - **Review**：审查 diff、找缺失测试
- **When to use** 这一栏一定要写。编排 Agent 靠它选择用哪个配置。
- 修改 Profile 只影响之后新建的 Agent。

**编排技能**（`Settings → Host → Agents → Orchestration skills` 安装，或运行 `npx skills add getpaseo/paseo`）：

| 技能 | 用途 |
|---|---|
| `/paseo` | 基础参考，教 Agent 怎么管理 Agent、工作区、定时任务 |
| `/paseo-handoff` | 带完整上下文把任务移交给另一个 Agent |
| `/paseo-advisor` | 让另一个 Agent 给第二意见（不改文件） |
| `/paseo-committee` | 两个 Agent（尽量来自不同厂商）独立分析难题，主 Agent 综合后实现 |

## 7. 定时任务与心跳

| | Schedule | Heartbeat |
|---|---|---|
| 每次运行 | **新建**一个 Agent | 向**同一个** Agent 发提示 |
| 适合 | 每日 issue 分拣、依赖更新、巡检 | 长任务分步推进、盯构建直到通过 |
| 管理 | 查看、暂停、恢复、立即运行一次、修改、删除 | 只能创建或删除（CLI 可以改 cron） |

**三种创建方式**：
- **界面**：左侧 **Schedules** → **Create schedule**，填写 Agent 设置、cron、仓库和提示词。
- **对话里直接说**（最方便），例如：
  - "每个工作日早 9 点分拣新 issue 和 PR 并汇总"
  - "每 5 分钟检查 release 构建，失败就修"
  - "每 20 分钟唤醒自己继续这个重构，完成后删掉心跳"
- **CLI**：`paseo schedule create --every 30m --cwd <dir> --provider codex/gpt-5.5 --max-runs 16 "..."`

**时区**：默认按 UTC 计算。按本地时间运行要加 `--timezone Asia/Shanghai`；在对话里说明"北京时间"也可以。

## 8. 浏览器自动化（仅桌面端）

打开方式：`Settings → Host → Agents → Browser tools`。同时需要 **Enable Paseo tools** 已开启。

- Agent 可以操作你在 Paseo 里看到的那个浏览器标签：打开 dev server、点击、填表、截图、读 console 和 network 日志，用来**自己验证改动**。
- 标签共享你的登录状态：你先手动登录，Agent 就能在登录后的页面里测试。**只对信任的 Agent 开启。**
- Agent 只能看到自己工作区里的标签，只能访问 http(s) 地址，上传的文件也限于工作区内。
- 跑无头 CI 或已有的测试套件时，仍然用 Playwright。

## 9. 远程访问（手机 / 其他电脑）

| 方式 | 适用 | 操作 |
|---|---|---|
| **Relay 中继**（推荐） | 手机随时随地访问，无需端口转发 | `Settings → Host → Pair a device → Enable relay` → 用手机扫二维码 |
| **Tailscale** | 自己的 VPN | `config.json` 设 `daemon.listen: "<tailscale-ip>:6767"` 并设置密码 → 重启 daemon → 手机上 `Add host → Direct connection` |
| **SSH** | 连远程服务器上的 daemon | 桌面端 `Settings → Add host → Remote SSH`，填 `ssh://user@host` |
| **自托管 Web UI** | 浏览器访问 | `paseo daemon config set features.webUi.enabled true`，然后打开 `http://localhost:6767` |

**安全要点**：
- Relay 端到端加密，中继服务器看不到内容。但**二维码和配对链接等同于密码**，不要外传。
- daemon 一旦监听非 localhost 地址（尤其是 `0.0.0.0`），必须先运行 `paseo daemon set-password`。
- 密码只控制谁能访问，不加密流量。在不可信的网络上，要用 Relay、VPN 或 HTTPS。

## 10. 扩展 Provider（`~/.paseo/config.json`）

```json
{
  "agents": {
    "providers": {
      "zai":     { "extends": "claude", "label": "ZAI",
                   "env": { "ANTHROPIC_AUTH_TOKEN": "<key>", "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic" },
                   "disallowedTools": ["WebSearch"],
                   "models": [{ "id": "glm-5.1", "label": "GLM 5.1", "isDefault": true }] },
      "claude-work": { "extends": "claude", "label": "Claude (Work)", "env": { "ANTHROPIC_API_KEY": "..." } },
      "gemini":  { "extends": "acp", "label": "Gemini", "command": ["gemini", "--acp"] },
      "claude":  { "command": ["C:/path/to/claude.exe"] },
      "copilot": { "enabled": false }
    }
  }
}
```

**上例中的用法**：
- **接第三方兼容端点**：`zai` 把 claude 指向 Anthropic 兼容接口（Z.AI / 通义等）。这类端点要禁用 `WebSearch`。
- **多账号**：`claude-work` 对同一个 Provider 再建一份配置，用不同的凭据。
- **任意 ACP Agent**：`gemini` 用 `extends: "acp"` 加启动命令接入。
- **手动指定路径**：`claude` 覆盖可执行文件的位置。
- **禁用**：`copilot` 用 `enabled: false` 关掉不用的 Provider。

**其他规则**：
- `models` 会**替换**整个模型列表；`additionalModels` 是**合并**。
- `paseoTools` 可以按 Provider 限制可用的 Paseo 工具，例如让 worker 不能再派生 Agent。
- 改完运行 `paseo reload`，对之后启动的 Agent 生效。

## 11. 语音

- 支持**听写**（语音转文字输入）和**语音模式**（直接语音对话，可以指挥 Agent）。默认在本机 CPU 上运行。
- 本地识别模型：默认 `parakeet v2` 只支持**英语**；`v3` 支持 25 种欧洲语言，**也不支持中文**。
- **要用中文语音，需要把 STT 切到 OpenAI**：

```json
{ "features": { "dictation": { "stt": { "provider": "openai", "language": "zh" } } },
  "providers": { "openai": { "apiKey": "sk-..." } } }
```

语音相关设置改完后需要重启 daemon。

## 12. CLI 速查

```bash
paseo run "任务"                              # 新建 Agent 并等待完成（--background 立即返回）
paseo run --provider codex/gpt-5.5 "..."      # 指定 provider/模型
paseo run --new-workspace worktree --worktree-mode branch-off \
          --new-branch feat/x --base origin/main "..."   # 建 worktree 工作区并启动 Agent
paseo ls [-a 含归档] [-g 所有工作区]           # 列出 Agent
paseo attach <id> | logs <id> -f | wait <id>  # 看输出 / 跟踪 / 等待完成
paseo send <id> "追加指令" [--image x.png]     # 追加消息
paseo stop <id>                               # 停止 Agent
paseo permit ls | allow <id> | deny <id> --all # 权限请求
paseo agent mode <id> plan|bypass             # 切换模式
paseo workspace create|ls|rename|archive      # 工作区
paseo script ls|start web|stop web            # paseo.json 脚本
paseo schedule create|ls|pause|resume|run-once|delete
paseo provider diagnostic <provider>          # 诊断 Provider
paseo daemon status | reload | restart | pair [--relay]
paseo --host <地址或配对链接> <命令>            # 操作远程 daemon
```

- **ID 可以缩写**：Agent ID 只要不产生歧义，写前几位就行。
- **结构化输出**：`--output-schema <schema>` 让结果只返回符合 schema 的 JSON，适合脚本。
- **在 Agent 里调用**：Agent 内部运行 `paseo run`，新 Agent 会自动成为它的子 Agent。

## 13. 配置与排障

**常用配置项**（`~/.paseo/config.json`）：

| 配置 | 作用 |
|---|---|
| `daemon.listen` | 监听地址（默认 `127.0.0.1:6767`） |
| `daemon.mcp.injectIntoAgents` | 等同于界面上的 Enable Paseo tools |
| `daemon.browserTools.enabled` | 浏览器工具 |
| `daemon.relay.enabled` | 中继 |
| `daemon.hostnames` | 域名白名单，防 DNS rebinding |
| `worktrees.root` / `worktrees.servicePorts.range` | worktree 存放位置 / 服务端口范围 |
| `agents.providers` | 自定义 Provider |
| `features.dictation` / `voiceMode` | 语音 |
| `features.webUi.enabled` | 自托管 Web UI |

**改完配置怎么生效**：
- 先运行 `paseo reload`，它会列出已生效的项和需要重启的项。
- 只有提示需要重启时才重启。监听地址、密码、语音、Web UI、worktree 分配这类设置需要重启。
- 界面里重启：`Settings → Host → Overview → Restart daemon`。重启不会中断正在运行的 Agent，客户端会自动重连。

**Provider 显示 Not installed**（最常见的问题）：
1. 打开 `Settings → Host → Providers → 该 Provider → Diagnostic`，看 **Resolved path** 和 **Daemon PATH**。
2. 通常是命令不在 Paseo 的 PATH 里。有两种修法：
   - 把 CLI 所在目录加入系统 PATH，然后重启 Paseo；
   - 或者在 `config.json` 里用 `command` 写绝对路径。
3. Codex 还需要注意：ChatGPT 桌面应用和 `codex` CLI 是两个东西，要单独安装 CLI。装好后到 Providers 里点 **Refresh**。

**日志位置**：
- 桌面端：`%APPDATA%\Paseo\logs\main.log`（Windows）
- daemon：`~/.paseo/daemon.log`

**遇到奇怪的 bug**：先确认桌面端和 daemon 版本一致（`Settings → About`）。想提前拿到修复，可以在 `About → Release channel` 切到 Beta。

## 14. 进阶

- **Hub**：用 GitHub、Slack、Discord 里的 @提及 或评论触发你机器上的 Agent。触发器写在仓库的 `.paseo/triggers/*.yml`，用 `paseo hub init/deploy` 部署。
- **TypeScript SDK**：`@getpaseo/client`，用代码创建和驱动 Agent，适合把 webhook 或告警转成编码任务。
- **插件**：给 Paseo 添加侧边栏、工作区面板、斜杠命令、主题，甚至新的 Provider。先在 `Settings → Plugins` 打开 Enable plugins。**插件代码不受沙箱限制，只装信任的插件。**
- **Docker**：`ghcr.io/getpaseo/paseo:latest`，适合服务器或 NAS。镜像里不含 Agent CLI，需要自己写子镜像安装。一定要设置 `PASEO_PASSWORD`。

---

**最佳实践**：
- **一个任务一个 worktree 工作区**，基底用 `origin/main`。
- **写好 `paseo.json`**，新 worktree 打开就能用。
- **建好 2～3 个 Profile**，并把"何时使用"写清楚。
- **打开 Paseo tools**，让主 Agent 负责分派和审查。
- **用 Relay 配对手机**，出门也能批准权限、追加指令。
