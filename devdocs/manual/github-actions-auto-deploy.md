# GitHub Actions + SSH 自动部署操作手册

本文档适用于以下部署环境：

- GitHub 仓库：`https://github.com/WoBok/WoboksVibeDaily.git`
- 自动部署分支：`main`
- Linux 部署用户：`admin`
- 服务器工程目录：`/home/admin/WoboksVibeDaily`
- systemd 服务：`woboks-vibe-daily.service`
- 只有 `notes/`、`skills/` 中的文件发生变化时，只更新文件，不重启服务
- 其他任何路径发生变化时，更新文件并重启服务

> 注意：仓库中的真实目录名是 `skills/`，不是 `skill/`。后文配置均使用 `skills`。

## 1. 结论与原方案审查

采用“GitHub Actions 通过 SSH 触发服务器脚本，服务器脚本自行比较并更新仓库”的架构是合理的。它比在 Actions Runner 中打包、传输整个工程更简单，也能让服务器成为部署状态的唯一执行者。

原方案中这些设计可以保留：

- 不使用 `paths-ignore`。即使只改 `notes/` 或 `skills/`，服务器仍需要收到通知并更新文件。
- 比较服务器旧提交与本次部署目标 commit 之间的完整差异，而不是只检查单个文件或单个 diff 片段。
- 使用 Bash 数组维护免重启目录，后续容易扩展。
- 使用 `git diff --name-only --no-renames -z`。`--no-renames` 能保证“代码文件移动到免重启目录”仍会触发重启，`-z` 能正确处理带空格等特殊字符的路径。
- 更新前检查工作区、使用 `flock` 防止并发部署、限制 sudo 只能重启指定服务。
- Actions 不直接判断是否重启；最终判断以服务器实际旧版本和本次精确目标 commit 为准。

需要修正或补充的地方：

1. 原文的 `/srv/woboks-vibe-daily`、`deploy` 用户应改成实际的 `/home/admin/WoboksVibeDaily`、`admin`。
2. 原文写的是 `skill`，实际仓库目录是 `skills`。
3. 必须区分两条 SSH 链路：Actions 登录服务器，以及服务器读取 GitHub。两者不是同一把密钥。
4. 只更新 `notes/` 后不重启，依赖服务启用了文件监听，即 systemd 中没有设置 `WATCH=0`。当前项目默认会递归监听 `notes/`，约 0.5 秒后刷新内存索引。
5. Actions 应先判断完整变更路径：如果变化全部位于可扩展的免测试目录数组中，则跳过 `npm test`；只要存在数组外变化或无法可靠取得差异，就先测试再部署。
6. 部署后应检查 systemd 状态和 `/api/tree` 健康接口；失败时应回退到旧提交并重新启动旧版本。
7. 应给 SSH 增加严格 Host Key 校验、连接超时和非交互模式，避免主机冒充或任务无限等待。
8. 当前项目没有第三方依赖和构建步骤，因此脚本不运行 `npm install`。以后若增加依赖，应提交 lockfile，并在部署流程中增加 `npm ci`。

## 2. 最终工作流程

```text
本地 push 到 main
  -> GitHub Actions 判断完整变更路径
     -> 只有 notes/、skills/：跳过 npm test
     -> 存在其他变化或无法可靠判断：运行 npm test
  -> Actions 使用专用 SSH Key 登录服务器，并传递本次 github.sha
  -> 服务器脚本取得部署锁
  -> fetch origin/main
  -> 校验目标 commit 仍属于 origin/main
  -> 比较服务器 HEAD 与本次目标 commit
  -> reset 到本次目标 commit
  -> 只有 notes/、skills/ 变化：结束，不重启
  -> 存在其他变化：重启 systemd，检查服务和 HTTP
  -> 检查失败：回退旧提交并重启旧版本，Actions 标记失败
```

判断示例：

| 变化 | 更新文件 | 重启服务 |
| --- | --- | --- |
| `notes/today.md` | 是 | 否 |
| `skills/example/SKILL.md` | 是 | 否 |
| `notes/a.md` 与 `skills/x.md` | 是 | 否 |
| `notes/a.md` 与 `server/index.js` | 是 | 是 |
| `app.js`、`style.css` 或根目录文件 | 是 | 是 |
| 删除 `server/index.js` | 是 | 是 |
| 将 `server/a.js` 移到 `notes/a.js` | 是 | 是 |
| 将 `notes/a.md` 移到 `skills/a.md` | 是 | 否 |
| 只有空提交，文件树没有变化 | 是 | 否 |

## 3. 部署脚本应该放在哪里

推荐路径：

```text
/usr/local/bin/deploy-woboks-vibe-daily.sh
```

推荐放在工程目录之外，原因是：

- 可以由 `root` 持有，`admin` 只有执行权限，Actions 使用的 SSH Key 不能修改部署逻辑。
- 不会被 Git 的工作区检查视为未跟踪文件。
- `git reset --hard` 更新工程时不会同时替换正在执行的部署入口。
- 工程目录损坏、分支切换或回退时，部署入口仍然存在。

放在 `/home/admin/WoboksVibeDaily` 技术上可以，但不是首选。如果必须这样做：

- 最好把脚本提交到 Git，不能在服务器上手动改出未提交内容。
- 如果不提交到 Git，必须把它写入服务器仓库的 `.git/info/exclude`，否则工作区保护会终止部署。
- `authorized_keys` 和 Workflow 中的命令路径都要同步修改。
- 工程目录由 `admin` 可写，因此强制 SSH 命令的防篡改能力会弱于 root 所有的 `/usr/local/bin`。

下文全部采用推荐的 `/usr/local/bin` 方案。

## 4. 服务器端准备

### 4.1 检查基础环境

登录服务器后执行：

```bash
id admin
git --version
node --version
npm --version
command -v bash
command -v flock
command -v systemctl
command -v curl
sudo systemctl status woboks-vibe-daily --no-pager
sudo systemctl show woboks-vibe-daily -p User -p Group
```

预期：

- Node.js 为 22 或更高版本。
- 这台服务器上 `command -v systemctl` 的实际输出是 `/bin/systemctl`。后面的部署脚本和 sudoers 均按这个真实绝对路径配置。
- 服务已存在，并以 `/home/admin/WoboksVibeDaily` 为 `WorkingDirectory`。
- `flock` 可用；在 Debian/Ubuntu 中它通常由 `util-linux` 提供。

systemd 系统级服务如果没有配置 `User=`，默认会以 root 运行。网站进程通常不需要 root 权限，建议服务文件的 `[Service]` 中包含：

```ini
User=admin
Group=admin
WorkingDirectory=/home/admin/WoboksVibeDaily
```

修改服务文件后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart woboks-vibe-daily
```

确认服务没有关闭文章监听：

```bash
sudo systemctl cat woboks-vibe-daily
```

不能存在下面这项：

```ini
Environment=WATCH=0
```

如果确实必须使用 `WATCH=0`，不要把 `notes` 放入免重启数组；或者自行扩展脚本，在只更新文章时调用 `POST /api/rebuild`。

### 4.2 检查服务器仓库

```bash
sudo -iu admin
cd /home/admin/WoboksVibeDaily
git status --short --branch
git branch --show-current
git remote -v
git fetch origin main
exit
```

必须满足：

- 当前分支是 `main`。
- 工作区干净。
- `origin` 指向 `WoBok/WoboksVibeDaily`。
- `admin` 用户可以非交互地执行 `git fetch`。

部署脚本使用 `git fetch` 加 `git reset --hard origin/main`，而不是 `git pull`。这样不会在服务器产生合并提交，部署结果会精确等于 GitHub 的 `main`。脚本会先拒绝脏工作区，但服务器上额外创建的本地 commit 仍可能被丢弃；不要直接在服务器仓库提交代码。

### 4.3 配置服务器读取 GitHub

这是“服务器 -> GitHub”的认证，与 Actions 登录服务器的密钥无关。

#### 方案 A：仓库可通过 HTTPS 只读访问

如果下面的命令可以在不输入用户名和密码的情况下成功，保持 HTTPS 即可，不需要额外 Deploy Key：

```bash
sudo -iu admin
git -C /home/admin/WoboksVibeDaily remote set-url origin \
  https://github.com/WoBok/WoboksVibeDaily.git
git -C /home/admin/WoboksVibeDaily fetch origin main
exit
```

#### 方案 B：私有仓库使用只读 Deploy Key

以 `admin` 身份生成服务器专用密钥：

```bash
sudo -iu admin
mkdir -p ~/.ssh
chmod 700 ~/.ssh

ssh-keygen \
  -t ed25519 \
  -C "woboks-vibe-daily-server-readonly" \
  -f ~/.ssh/woboks-vibe-daily-github \
  -N ""
```

显示公钥：

```bash
cat ~/.ssh/woboks-vibe-daily-github.pub
```

在 GitHub 仓库中打开：

```text
Settings -> Deploy keys -> Add deploy key
```

填写：

- Title：`woboks-vibe-daily production server`
- Key：粘贴公钥
- 不要勾选 `Allow write access`

Deploy Key 默认可以设置为只读，并且只绑定一个仓库。参见 [GitHub 官方 Deploy Key 文档](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)。

在服务器上取得 GitHub SSH Host Key，并核对指纹：

```bash
ssh-keyscan -t ed25519 github.com > /tmp/github-ed25519-host-key
ssh-keygen -lf /tmp/github-ed25519-host-key
```

输出必须与 [GitHub 官方 SSH 指纹](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) 中的 Ed25519 指纹一致。核对后执行：

```bash
cat /tmp/github-ed25519-host-key >> ~/.ssh/known_hosts
rm /tmp/github-ed25519-host-key
chmod 600 ~/.ssh/known_hosts
```

编辑 `~/.ssh/config`：

```sshconfig
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/woboks-vibe-daily-github
    IdentitiesOnly yes
    StrictHostKeyChecking yes
```

设置权限并测试：

```bash
chmod 600 ~/.ssh/config
chmod 600 ~/.ssh/woboks-vibe-daily-github

git -C /home/admin/WoboksVibeDaily remote set-url origin \
  git@github.com:WoBok/WoboksVibeDaily.git

ssh -T git@github.com || true
git -C /home/admin/WoboksVibeDaily fetch origin main
exit
```

`ssh -T` 可能以非零状态结束并显示 GitHub 不提供 shell，这是正常的；真正必须成功的是最后的 `git fetch`。

## 5. 创建服务器部署脚本

执行：

```bash
sudo nano /usr/local/bin/deploy-woboks-vibe-daily.sh
```

粘贴以下完整内容：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPO_DIR="/home/admin/WoboksVibeDaily"
readonly REMOTE="origin"
readonly BRANCH="main"
readonly SERVICE="woboks-vibe-daily.service"
readonly SYSTEMCTL="/bin/systemctl"
readonly HEALTHCHECK_URL="http://127.0.0.1:55555/api/tree"
readonly LOCK_FILE="/home/admin/.woboks-vibe-daily-deploy.lock"

# 只有这些目录中的文件发生变化时，不重启服务。
# 使用仓库根目录下的相对目录名，不要以 / 开头。
readonly NO_RESTART_DIRS=(
  "notes"
  "skills"
  # "以后新增的目录"
)

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

# authorized_keys 的强制命令会把 Actions 请求的原始命令放在
# SSH_ORIGINAL_COMMAND 中。只接受：deploy <40位commit SHA>。
# 服务器上直接执行脚本时该变量为空，此时部署远端 main 最新提交。
target_commit=""
if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  read -r requested_command requested_commit extra \
    <<< "$SSH_ORIGINAL_COMMAND"

  if [[ "$requested_command" != "deploy" \
    || ! "$requested_commit" =~ ^[0-9a-f]{40}$ \
    || -n "${extra:-}" ]]; then
    fail "SSH 部署请求格式不合法"
  fi

  target_commit="$requested_commit"
fi

is_no_restart_path() {
  local file="$1"
  local dir

  for dir in "${NO_RESTART_DIRS[@]}"; do
    dir="${dir#/}"
    dir="${dir%/}"

    # 只匹配目录内的文件；notes-other/ 不会误匹配 notes/。
    if [[ -n "$dir" && "$file" == "$dir/"* ]]; then
      return 0
    fi
  done

  return 1
}

show_service_status() {
  "$SYSTEMCTL" --no-pager --full status "$SERVICE" || true
}

rollback() {
  local old_commit="$1"

  log "新版本检查失败，开始回退到 $old_commit"
  git reset --hard "$old_commit"

  if ! sudo -n "$SYSTEMCTL" restart "$SERVICE"; then
    show_service_status
    fail "回退了代码，但旧版本服务也无法重启，需要人工处理"
  fi

  show_service_status
  fail "部署失败，已回退并重新启动旧版本"
}

exec 9>"$LOCK_FILE"
flock -w 120 9 || fail "120 秒内未取得部署锁，可能已有部署正在执行"

[[ -d "$REPO_DIR/.git" ]] || fail "不是 Git 仓库：$REPO_DIR"
cd "$REPO_DIR"

current_branch="$(git symbolic-ref --quiet --short HEAD || true)"
[[ "$current_branch" == "$BRANCH" ]] || \
  fail "当前分支是 ${current_branch:-detached HEAD}，预期为 $BRANCH"

# 防止服务器手工修改或未跟踪文件被覆盖。
# .gitignore 中已忽略的运行时文件不会出现在这里。
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  git status --short >&2
  fail "Git 工作区不干净，拒绝部署"
fi

old_commit="$(git rev-parse HEAD)"

log "正在更新 $REMOTE/$BRANCH"
git fetch --prune "$REMOTE" \
  "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"

remote_commit="$(git rev-parse "$REMOTE/$BRANCH")"

if [[ -n "$target_commit" ]]; then
  # 正常队列中，目标提交应当等于或早于当前 origin/main。
  # 如果 force-push 使它不再属于 main，则失败退出，不部署未知提交。
  git cat-file -e "${target_commit}^{commit}" 2>/dev/null || \
    fail "目标提交不存在：$target_commit"

  git merge-base --is-ancestor "$target_commit" "$remote_commit" || \
    fail "目标提交已不属于当前 $REMOTE/$BRANCH：$target_commit"

  new_commit="$(git rev-parse "${target_commit}^{commit}")"
  log "本次部署目标：$new_commit"
else
  new_commit="$remote_commit"
  log "未指定目标提交，部署当前 $REMOTE/$BRANCH：$new_commit"
fi

# 重新运行很早以前的 Workflow 时，不能把已经更新的服务器降级回旧提交。
if [[ -n "$target_commit" \
  && "$old_commit" != "$new_commit" ]] \
  && git merge-base --is-ancestor "$new_commit" "$old_commit"; then
  fail "目标提交早于服务器当前版本，拒绝降级：$new_commit"
fi

if [[ "$old_commit" == "$new_commit" ]]; then
  log "已经是最新版本：$new_commit"
  exit 0
fi

changed_files=()
while IFS= read -r -d '' file; do
  changed_files+=("$file")
done < <(
  git diff --name-only --no-renames -z "$old_commit" "$new_commit"
)

restart_required=false

if ((${#changed_files[@]} == 0)); then
  log "两个提交的文件树相同，不需要重启"
else
  log "变更文件："
  for file in "${changed_files[@]}"; do
    printf '  - %s\n' "$file"
    if ! is_no_restart_path "$file"; then
      restart_required=true
    fi
  done
fi

git reset --hard "$new_commit"
log "工程已更新：$old_commit -> $new_commit"

if [[ "$restart_required" == false ]]; then
  log "变化仅位于免重启目录，部署完成，不重启服务"
  exit 0
fi

log "检测到免重启目录之外的变化，正在重启 $SERVICE"
if ! sudo -n "$SYSTEMCTL" restart "$SERVICE"; then
  rollback "$old_commit"
fi

if ! "$SYSTEMCTL" is-active --quiet "$SERVICE"; then
  show_service_status
  rollback "$old_commit"
fi

health_ok=false
for attempt in {1..10}; do
  if curl --fail --silent --show-error --max-time 3 \
    "$HEALTHCHECK_URL" >/dev/null; then
    health_ok=true
    break
  fi
  sleep 1
done

if [[ "$health_ok" == false ]]; then
  show_service_status
  rollback "$old_commit"
fi

log "服务已重启，健康检查通过，部署完成"
```

本服务器的 `command -v systemctl` 输出为 `/bin/systemctl`，因此脚本中的 `SYSTEMCTL` 也必须是 `/bin/systemctl`。如果以后迁移服务器，应重新运行该命令并同步调整。

设置所有权和权限：

```bash
sudo chown root:root /usr/local/bin/deploy-woboks-vibe-daily.sh
sudo chmod 755 /usr/local/bin/deploy-woboks-vibe-daily.sh
sudo bash -n /usr/local/bin/deploy-woboks-vibe-daily.sh
```

为什么使用 `--no-renames`：如果 `server/a.js` 被移动到 `notes/a.js`，Git 会把它作为旧代码路径删除和新文章路径新增来判断，旧路径不在免重启目录内，因此仍会重启。Git 对 `-z` 路径输出的说明见 [git diff 官方文档](https://git-scm.com/docs/git-diff)。

## 6. 配置最小 sudo 权限

先确认 systemctl 的真实路径：

```bash
command -v systemctl
```

创建专用 sudoers 文件：

```bash
sudo visudo -f /etc/sudoers.d/woboks-vibe-daily-deploy
```

如果路径是 `/bin/systemctl`，写入一行：

```sudoers
admin ALL=(root) NOPASSWD: /bin/systemctl restart woboks-vibe-daily.service
```

保存后检查：

```bash
sudo chmod 440 /etc/sudoers.d/woboks-vibe-daily-deploy
sudo visudo -cf /etc/sudoers.d/woboks-vibe-daily-deploy
sudo -n /bin/systemctl restart woboks-vibe-daily.service
```

当前登录提示符已经显示用户是 `admin`，所以直接执行最后一条 `sudo -n` 测试即可，不要再套一层 `sudo -iu admin`。`-n` 表示禁止交互式询问密码：配置正确时命令直接成功，配置不匹配时立即报错。

不要配置 `admin ALL=(ALL) NOPASSWD: ALL`。脚本只需要重启这一个 unit。

## 7. 创建 Actions 登录服务器的专用 SSH Key

这是“GitHub Actions -> 服务器”的 Key A。不要复用个人 SSH Key，也不要复用服务器读取 GitHub 的 Deploy Key。

在可信任的本地电脑上执行：

```bash
ssh-keygen \
  -t ed25519 \
  -C "github-actions-woboks-vibe-daily" \
  -f github-actions-woboks-vibe-daily \
  -N ""
```

生成：

```text
github-actions-woboks-vibe-daily       私钥，稍后放入 GitHub Secret
github-actions-woboks-vibe-daily.pub   公钥，放入服务器 authorized_keys
```

在服务器上准备 `admin` 的 SSH 目录：

```bash
sudo -iu admin
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

将 `.pub` 文件中的完整一行追加到 `authorized_keys`，并在行首加入限制：

```text
command="/usr/local/bin/deploy-woboks-vibe-daily.sh",no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty,no-user-rc ssh-ed25519 AAAAC3... github-actions-woboks-vibe-daily
```

不要照抄 `AAAAC3...`，必须使用你自己 `.pub` 文件中的完整公钥。保存后再次执行：

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
exit
```

`command="..."` 是强制命令。即使 Actions 或密钥持有者请求执行其他命令，SSH 也只会运行部署脚本；其余选项关闭端口转发、Agent 转发、X11 和交互终端。

## 8. 生成服务器 Host Key Secret

Actions 必须验证“连接到的确实是你的服务器”，不能使用 `StrictHostKeyChecking=no`。

先在服务器上查看 Host Key 指纹：

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

网站域名是 `wobok.tech`。先在可信任的本地电脑确认它确实也是服务器的 SSH 登录地址：

```bash
ssh -p 22 admin@wobok.tech
```

如果这条命令能够连接到目标服务器，就使用 `wobok.tech`，而不是 `your-server.wobok.tech`。`your-server.example.com` 只是占位示例，不能把 `your-server` 机械地加在真实域名前面。

在 Windows PowerShell 中生成文件：

```powershell
ssh-keyscan -p 22 -t ed25519 -H wobok.tech |
  Set-Content -Encoding ascii deploy_known_hosts

ssh-keygen -lf deploy_known_hosts
```

在 Bash、Git Bash、Linux 或 macOS 中生成文件：

```bash
ssh-keyscan -p 22 -t ed25519 -H wobok.tech > deploy_known_hosts
ssh-keygen -lf deploy_known_hosts
```

如果需要把 Bash 命令拆成多行，反斜杠 `\` 必须是该行最后一个字符，后面不能有空格：

```bash
ssh-keyscan -p 22 -t ed25519 -H wobok.tech \
  > deploy_known_hosts
```

两边指纹必须一致。不要只运行 `ssh-keyscan` 后不核对指纹，因为未经验证的扫描结果不能防止中间人攻击。

稍后把 `deploy_known_hosts` 的完整内容放入 GitHub Secret `DEPLOY_KNOWN_HOSTS`。

扫描目标、Secret 和实际 SSH 连接目标必须完全一致：

```text
ssh-keyscan：wobok.tech
DEPLOY_HOST：wobok.tech
Actions 连接：admin@wobok.tech
DEPLOY_PORT：22
```

如果 `wobok.tech` 启用了 Cloudflare 代理，普通 Cloudflare 代理通常不能直接转发 SSH 22 端口。此时应改用服务器公网 IP，或者创建一个仅 DNS 解析、不启用代理的专用记录，例如 `ssh.wobok.tech`。选择哪个地址，就必须对同一地址执行 `ssh-keyscan` 并填写 `DEPLOY_HOST`。

如果 Actions 使用 IP 连接，就必须对相同 IP 执行 `ssh-keyscan`，并把该 IP 填入 `DEPLOY_HOST`；Host Key 条目中的主机名/IP 和端口必须与实际连接目标一致。

## 9. 配置 GitHub Actions Secrets

打开仓库：

```text
https://github.com/WoBok/WoboksVibeDaily
-> Settings
-> Secrets and variables
-> Actions
-> New repository secret
```

添加：

| Secret | 值 |
| --- | --- |
| `DEPLOY_HOST` | 如果 SSH 可通过网站域名登录则填 `wobok.tech`；否则填实际 SSH 域名或公网 IP，不带 `https://` |
| `DEPLOY_PORT` | SSH 端口，例如 `22` |
| `DEPLOY_USER` | `admin` |
| `DEPLOY_SSH_KEY` | Key A 私钥文件的完整内容，包括 BEGIN/END 行 |
| `DEPLOY_KNOWN_HOSTS` | 上一步 `deploy_known_hosts` 的完整内容 |

### 9.1 在 `New repository secret` 页面逐个填写

每次点击一次 `New repository secret`，分别创建下面 5 个 Secret。`Name` 中只填写名称本身，`Secret` 中只填写值；不要加引号、反引号，也不要写成 `NAME=value`。

第 1 个：

```text
Name: DEPLOY_HOST
Secret: wobok.tech
```

只有当下面的命令确实可以连接服务器时，`Secret` 才填写 `wobok.tech`：

```bash
ssh -p 22 admin@wobok.tech
```

如果不能通过 `wobok.tech` 连接 SSH，则把 `Secret` 改为服务器公网 IP，或者实际可用于 SSH 的域名（例如仅 DNS 解析的 `ssh.wobok.tech`）。不要填写 `https://wobok.tech`，也不要在值末尾添加 `/`。

第 2 个：

```text
Name: DEPLOY_PORT
Secret: 22
```

如果服务器 SSH 使用的不是 22 端口，则把 `22` 换成实际端口。

第 3 个：

```text
Name: DEPLOY_USER
Secret: admin
```

第 4 个：

```text
Name: DEPLOY_SSH_KEY
Secret: 粘贴 github-actions-woboks-vibe-daily 私钥文件的完整内容
```

在生成 Key A 的目录中，可以在 Windows PowerShell 执行：

```powershell
Get-Content -Raw .\github-actions-woboks-vibe-daily
```

把命令输出从第一行到最后一行完整复制到 `Secret`，格式类似下面这样：

```text
-----BEGIN OPENSSH PRIVATE KEY-----
私钥正文（会有多行，以你自己的文件内容为准）
-----END OPENSSH PRIVATE KEY-----
```

这里必须使用没有 `.pub` 后缀的私钥文件。不要粘贴 `github-actions-woboks-vibe-daily.pub`，不要把真实私钥写进本文档、Git 仓库、聊天或服务器的 `authorized_keys`。

第 5 个：

```text
Name: DEPLOY_KNOWN_HOSTS
Secret: 粘贴 deploy_known_hosts 文件的完整内容
```

在生成 `deploy_known_hosts` 的目录中，可以在 Windows PowerShell 执行：

```powershell
Get-Content -Raw .\deploy_known_hosts
```

把完整输出复制到 `Secret`。使用前面的 `ssh-keyscan -H` 命令生成时，其格式通常类似：

```text
|1|经过哈希处理的主机名字段|哈希值 ssh-ed25519 AAAA...服务器主机公钥
```

不要把上面的格式示例原样填写进去，必须粘贴你实际生成并已与服务器指纹核对一致的那一行。`DEPLOY_KNOWN_HOSTS` 对应的主机名/IP 和端口，必须与 `DEPLOY_HOST`、`DEPLOY_PORT` 完全一致。如果修改了连接地址或端口，需要针对新的地址和端口重新运行 `ssh-keyscan`，重新核对指纹，然后更新此 Secret。

创建完成后，Actions Secrets 列表应能看到以下 5 个名称：

```text
DEPLOY_HOST
DEPLOY_PORT
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_KNOWN_HOSTS
```

GitHub 保存后不会再次显示 Secret 的明文，这是正常的。如果怀疑某项复制错误，进入该 Secret 的更新页面重新粘贴并保存即可。

GitHub 创建仓库级 Secret 的官方路径和使用方式见 [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

可选增强：在 `Settings -> Environments` 创建 `production` 环境，将这些 Secret 改为 Environment secrets，并按需要增加人工审批或限制可部署分支。若这样做，需要在 Workflow 的 `deploy` job 中增加 `environment: production`。

## 10. 创建 GitHub Actions Workflow

在本地工程创建：

```text
.github/workflows/deploy.yml
```

内容如下：

```yaml
name: Conditional test and deploy woboks-vibe-daily

on:
  push:
    branches:
      - main
  workflow_dispatch:

concurrency:
  group: production-woboks-vibe-daily
  cancel-in-progress: false
  queue: max

permissions:
  contents: read

jobs:
  check:
    name: Check changes and run tests when needed
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Check out repository
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Decide whether tests are required
        id: changes
        shell: bash
        env:
          EVENT_NAME: ${{ github.event_name }}
          BEFORE_SHA: ${{ github.event.before }}
          AFTER_SHA: ${{ github.sha }}
        run: |
          set -Eeuo pipefail

          # 只有这些目录中的文件发生变化时，跳过 npm test。
          # 后续可以继续向数组中添加仓库根目录下的相对目录名。
          NO_TEST_DIRS=(
            "notes"
            "skills"
            # "docs"
          )

          is_no_test_path() {
            local file="$1"
            local dir

            for dir in "${NO_TEST_DIRS[@]}"; do
              dir="${dir#/}"
              dir="${dir%/}"

              if [[ -n "$dir" && "$file" == "$dir/"* ]]; then
                return 0
              fi
            done

            return 1
          }

          # 默认执行测试。只有能够可靠证明“全部变化都在免测试目录”时才跳过。
          run_tests=true

          if [[ "$EVENT_NAME" == "push" \
            && -n "$BEFORE_SHA" \
            && ! "$BEFORE_SHA" =~ ^0+$ ]]; then

            # force-push 时，旧提交可能不在 checkout 得到的历史中；尝试单独获取。
            if ! git cat-file -e "${BEFORE_SHA}^{commit}" 2>/dev/null; then
              git fetch --no-tags origin "$BEFORE_SHA" || true
            fi

            if git cat-file -e "${BEFORE_SHA}^{commit}" 2>/dev/null; then
              changed_files=()
              while IFS= read -r -d '' file; do
                changed_files+=("$file")
              done < <(
                git diff --name-only --no-renames -z "$BEFORE_SHA" "$AFTER_SHA"
              )

              run_tests=false
              printf 'Changed files:\n'

              for file in "${changed_files[@]}"; do
                printf '  - %s\n' "$file"

                if ! is_no_test_path "$file"; then
                  run_tests=true
                  break
                fi
              done
            else
              echo "Cannot resolve the before commit; tests will run."
            fi
          else
            echo "This is a manual run or the first branch push; tests will run."
          fi

          echo "run_tests=$run_tests" >> "$GITHUB_OUTPUT"

          if [[ "$run_tests" == "true" ]]; then
            echo "Tests are required."
          else
            echo "All changes are inside NO_TEST_DIRS; npm test will be skipped."
          fi

      - name: Set up Node.js
        if: steps.changes.outputs.run_tests == 'true'
        uses: actions/setup-node@v6
        with:
          node-version: 22
          package-manager-cache: false

      - name: Run tests
        if: steps.changes.outputs.run_tests == 'true'
        run: npm test

  deploy:
    name: Deploy to production server
    needs: check
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Configure SSH
        shell: bash
        env:
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          DEPLOY_KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
        run: |
          set -Eeuo pipefail
          : "${DEPLOY_SSH_KEY:?DEPLOY_SSH_KEY is not configured}"
          : "${DEPLOY_KNOWN_HOSTS:?DEPLOY_KNOWN_HOSTS is not configured}"

          install -m 700 -d "$HOME/.ssh"
          printf '%s\n' "$DEPLOY_SSH_KEY" | tr -d '\r' \
            > "$HOME/.ssh/deploy_key"
          printf '%s\n' "$DEPLOY_KNOWN_HOSTS" | tr -d '\r' \
            > "$HOME/.ssh/known_hosts"
          chmod 600 "$HOME/.ssh/deploy_key"
          chmod 600 "$HOME/.ssh/known_hosts"

      - name: Run deployment
        shell: bash
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_PORT: ${{ secrets.DEPLOY_PORT }}
          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
          TARGET_COMMIT: ${{ github.sha }}
        run: |
          set -Eeuo pipefail
          : "${DEPLOY_HOST:?DEPLOY_HOST is not configured}"
          : "${DEPLOY_USER:?DEPLOY_USER is not configured}"
          : "${TARGET_COMMIT:?github.sha is empty}"

          if [[ ! "$TARGET_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
            echo "Invalid target commit: $TARGET_COMMIT" >&2
            exit 1
          fi

          port="${DEPLOY_PORT:-22}"

          ssh \
            -i "$HOME/.ssh/deploy_key" \
            -p "$port" \
            -o BatchMode=yes \
            -o IdentitiesOnly=yes \
            -o StrictHostKeyChecking=yes \
            -o UserKnownHostsFile="$HOME/.ssh/known_hosts" \
            -o ConnectTimeout=15 \
            -o ServerAliveInterval=15 \
            -o ServerAliveCountMax=2 \
            "$DEPLOY_USER@$DEPLOY_HOST" \
            "deploy $TARGET_COMMIT"
```

说明：

- `push.branches: main` 只在 `main` 更新时自动部署；GitHub 的分支过滤规则见 [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。
- `NO_TEST_DIRS` 是免测试目录数组。变化全部位于 `notes/`、`skills/` 时，Node 环境设置和 `npm test` 都会跳过，然后直接进入部署 job。
- 只要出现一个数组外路径，就会运行全部现有 Node 测试；失败时 `deploy` 不会运行。
- `workflow_dispatch` 手动重跑和无法可靠取得旧提交的情况默认执行测试，避免因为无法判断而错误跳过。
- `--no-renames` 会把重命名视为旧路径删除和新路径新增。例如代码从 `server/` 移入 `notes/`，旧的 `server/` 路径仍会使测试执行。
- 项目当前没有第三方依赖，因此测试前不需要 `npm install` 或 `npm ci`。
- `concurrency.queue: max` 会保留等待中的部署，而不是只保留最后一个 pending run；每次 push 的路径判断和部署不会被中间跳过。服务器上的 `flock` 是第二层保护。GitHub 的并发行为见 [Control workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。
- Workflow 的路径判断只决定是否运行测试；服务器脚本仍会独立判断是否重启。
- Actions 将本次 `${{ github.sha }}` 作为 `deploy <commit>` 发送。`authorized_keys` 的强制命令不会直接执行这个字符串，而是由 root 所有的部署脚本从 `SSH_ORIGINAL_COMMAND` 读取、校验并部署精确 commit。因此快速连续 push 时，较早的 run 不会越过测试去提前拉取后续 commit。
- 如果误操作重新运行了一个明显早于服务器当前版本的旧 Workflow，服务器脚本会拒绝降级。
- Actions 官方 action 的当前主版本可在 [actions/checkout](https://github.com/actions/checkout) 和 [actions/setup-node](https://github.com/actions/setup-node) 查看。

> `NO_TEST_DIRS` 和服务器脚本的 `NO_RESTART_DIRS` 是两个独立数组。前者决定是否测试，后者决定部署后是否重启。当前两者都是 `notes`、`skills`；以后修改时应分别确认语义并保持需要的一致性。

将 `.github/workflows/deploy.yml` 提交并 push 到 `main` 后，Actions 才会开始运行。

## 11. 首次测试顺序

### 11.1 在服务器直接测试部署脚本

以 `admin` 登录服务器后执行：

```bash
/usr/local/bin/deploy-woboks-vibe-daily.sh
```

如果服务器已是最新版本，应该显示“已经是最新版本”。

### 11.2 从本地测试 Actions 专用 SSH Key

在保存 Key A 私钥的可信任电脑上执行：

```bash
ssh \
  -i ./github-actions-woboks-vibe-daily \
  -p 22 \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  admin@wobok.tech \
  "deploy 0123456789abcdef0123456789abcdef01234567"
```

这里假设前面已经确认 `wobok.tech` 能直接用于 SSH；如果实际采用公网 IP 或 `ssh.wobok.tech`，这里也必须同步替换。不要照抄示例 SHA，请从 GitHub `main` 的最新提交页面复制真实的 40 位 commit SHA。由于 `authorized_keys` 配置了强制命令，服务器只会运行部署脚本，不能获得 shell；脚本还会拒绝 `deploy <40位SHA>` 之外的请求格式。

### 11.3 手动运行 Workflow

打开：

```text
GitHub 仓库 -> Actions -> Conditional test and deploy woboks-vibe-daily -> Run workflow
```

手动运行无法对应到一次确定的 push 差异，因此会采用安全默认值：执行 `Run tests`，测试通过后再执行 `Deploy to production server`。确认两者都成功。

### 11.4 验证“只更新、不重启”

先记录服务启动时间：

```bash
systemctl show woboks-vibe-daily.service \
  -p ActiveEnterTimestamp -p MainPID
```

只修改并 push 一个 `notes/` 文件。Actions 日志应显示：

```text
All changes are inside NO_TEST_DIRS; npm test will be skipped.
变化仅位于免重启目录，部署完成，不重启服务
```

再次执行 `systemctl show`，`MainPID` 应保持不变。约 0.5 秒后检查内容索引：

```bash
curl -fsS http://127.0.0.1:55555/api/tree
```

再用 `skills/` 中的文件重复一次。由于运行中的网站并不读取 `skills/`，它只需要被拉到服务器，不需要重启。

### 11.5 验证“更新并重启”

修改并 push 一个免重启目录之外的文件，例如 `app.js`。Actions 日志应显示健康检查通过；服务器上的 `MainPID` 或 `ActiveEnterTimestamp` 应变化。

## 12. 日常使用

配置完成后，日常只需要：

```bash
git add <files>
git commit -m "..."
git push origin main
```

之后在 GitHub 仓库的 Actions 页面查看结果。服务器上可查看：

```bash
git -C /home/admin/WoboksVibeDaily rev-parse HEAD
git -C /home/admin/WoboksVibeDaily log -1 --oneline
sudo systemctl status woboks-vibe-daily --no-pager
journalctl -u woboks-vibe-daily -n 100 --no-pager
```

以后要新增免重启目录，只修改服务器脚本中的数组：

```bash
readonly NO_RESTART_DIRS=(
  "notes"
  "skills"
  "docs"
  "prompts"
)
```

只有在确认新目录的内容不会被运行中的 Node.js 进程加载、缓存或执行时，才应加入该数组。

## 13. 常见故障

### Actions 连接超时

检查：

- `DEPLOY_HOST` 和 `DEPLOY_PORT` 是否正确。
- 云安全组、服务器防火墙是否允许该 SSH 端口。
- GitHub 托管 Runner 的出口地址会变化。如果服务器只允许固定 IP，需要使用自托管 Runner、VPN/私网连接，或维护 GitHub Actions IP 范围。

### `Host key verification failed`

- `DEPLOY_KNOWN_HOSTS` 中的主机名/IP 和端口必须与 `DEPLOY_HOST`、`DEPLOY_PORT` 一致。
- 服务器重装或 SSH Host Key 轮换后，要在可信环境重新核对指纹并更新 Secret。
- 不要改成 `StrictHostKeyChecking=no` 来绕过问题。

### `Permission denied (publickey)`

检查：

- `DEPLOY_SSH_KEY` 是否是 Key A 的私钥，不是 `.pub` 文件。
- `authorized_keys` 中是否是对应公钥。
- `/home/admin/.ssh` 权限为 700，`authorized_keys` 为 600，文件属于 `admin`。
- SSH 服务是否允许公钥认证。

### 部署脚本提示工作区不干净

查看：

```bash
sudo -iu admin git -C /home/admin/WoboksVibeDaily status --short
```

不要直接执行 `git reset --hard` 或删除文件，先确认这些修改是谁产生的、是否需要保留。被 `.gitignore` 忽略的 `server.log`、`server.err` 不会触发此保护。

### `git fetch` 要求认证或失败

以 `admin` 身份单独测试：

```bash
sudo -iu admin git -C /home/admin/WoboksVibeDaily fetch origin main
```

公有仓库可使用 HTTPS；私有仓库按第 4.3 节配置只读 Deploy Key。

### sudo 要求密码

测试精确命令：

```bash
sudo -n /bin/systemctl restart woboks-vibe-daily.service
```

这条命令应当在 `admin` 登录会话中直接运行。脚本、sudoers 中的 `systemctl` 路径和 unit 名必须完全一致；本服务器三处均应为 `/bin/systemctl`。

### 只更新 notes 后页面没有新内容

检查：

```bash
sudo systemctl cat woboks-vibe-daily
journalctl -u woboks-vibe-daily -n 100 --no-pager
curl -X POST http://127.0.0.1:55555/api/rebuild
```

如果服务配置了 `WATCH=0`，文章不会自动刷新。恢复默认监听，或从免重启数组移除 `notes`。

### 重启或健康检查失败

脚本会把工程回退到部署前的提交，并尝试重新启动旧版本，同时让 Actions 失败。查看：

```bash
sudo systemctl status woboks-vibe-daily --no-pager
journalctl -u woboks-vibe-daily -n 200 --no-pager
git -C /home/admin/WoboksVibeDaily status --short --branch
git -C /home/admin/WoboksVibeDaily log -1 --oneline
```

修复 GitHub 上的错误后再次 push，或在 Actions 页面手动运行 Workflow。

## 14. 当前方案的边界

- 当前工程零第三方依赖、无构建步骤，所以“更新后重启”已经足够。如果以后增加 npm 依赖，应提交 `package-lock.json`，在测试中执行 `npm ci`，并在服务器切换到新提交后、重启前执行生产依赖安装；安装失败时同样需要回退。
- 当前工程没有数据库迁移。如果以后引入不可逆数据库迁移，不能继续使用这里的简单 Git 自动回退，需要单独设计向前兼容和回滚策略。
- 本方案会让服务器精确跟随 GitHub `main`，包括 GitHub 上对 `main` 的 force-push。生产分支应启用分支保护并限制 force-push。
- SSH 私钥是长期凭据。需要定期轮换；怀疑泄露时，应立即从服务器 `authorized_keys` 删除 Key A，并在 GitHub 删除或替换 `DEPLOY_SSH_KEY`。
- 生产服务器不应是日常编辑环境。服务器运行数据应放在仓库外，或者加入 `.gitignore`；不要在仓库内保留未跟踪的重要数据。

## 15. 官方参考

- [GitHub Actions：使用 Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [GitHub Actions：触发 Workflow 与分支过滤](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub Actions：并发控制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [GitHub：管理 Deploy Keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
- [GitHub：SSH Host Key 指纹](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)
- [Git：git diff](https://git-scm.com/docs/git-diff)
- [actions/checkout](https://github.com/actions/checkout)
- [actions/setup-node](https://github.com/actions/setup-node)
