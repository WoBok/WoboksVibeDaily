>我现在有这样一个需求，我在我的电脑上将工程推送到Github之后，我的远程的服务器会自动下拉，我准备使用GitHub Actions + SSH的方式完成这个任务，我还有一个需求：当我下拉的工程中，如果只有notes和skill文件夹内的文件（这个文件夹最好是一个数组或者类似数组，我后续可以继续添加）发生了变化，则只拉取即可，如果notes以外的文件夹也更新了，那么我就需要运行sudo systemctl restart woboks-vibe-daily

这个需求最适合拆成两层：

1. **GitHub Actions**：每次 `main` 分支有 push，就通过 SSH 通知服务器。
2. **服务器部署脚本**：比较“服务器当前提交”和“远端最新提交”，拉取代码，并根据变化路径决定是否执行 `systemctl restart`。

不要使用 GitHub Actions 的 `paths-ignore` 跳过 `notes/`，因为即使只修改笔记，你仍然需要让服务器拉取。GitHub Actions 可以通过 `push.branches` 控制触发分支，并用 Secrets 保存 SSH 凭据。([GitHub Docs][1])

## 一、服务器部署脚本

在服务器创建：

```text
/usr/local/bin/deploy-woboks-vibe-daily.sh
```

内容如下：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================
# 基本配置
# ==============================

REPO_DIR="/srv/woboks-vibe-daily"
REMOTE="origin"
BRANCH="main"

SERVICE="woboks-vibe-daily.service"
SYSTEMCTL="/usr/bin/systemctl"

# 只有这些目录中的文件发生变化时，不重启服务。
# 后续直接向数组中添加目录即可。
NO_RESTART_DIRS=(
  "notes"
  "skill"
  # "docs"
  # "prompts"
)

# 防止两个部署同时操作同一个仓库。
LOCK_FILE="$HOME/.woboks-vibe-daily-deploy.lock"

exec 9>"$LOCK_FILE"

flock -w 120 9 || {
  echo "[deploy] 无法取得部署锁，已有部署正在执行。" >&2
  exit 1
}

cd "$REPO_DIR"

# ==============================
# 检查服务器工作区
# ==============================

# 防止服务器上的手动修改被覆盖。
# 被 .gitignore 忽略的运行时文件不会触发这里。
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "[deploy] Git 工作区不干净，已停止部署：" >&2
  git status --short >&2
  exit 1
fi

OLD_COMMIT="$(git rev-parse HEAD)"

# 显式更新远端 main 的 tracking ref。
git fetch --prune "$REMOTE" \
  "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"

NEW_COMMIT="$(git rev-parse "$REMOTE/$BRANCH")"

if [[ "$OLD_COMMIT" == "$NEW_COMMIT" ]]; then
  echo "[deploy] 已是最新版本：$NEW_COMMIT"
  exit 0
fi

# ==============================
# 路径判断函数
# ==============================

is_no_restart_path() {
  local path="$1"
  local dir

  for dir in "${NO_RESTART_DIRS[@]}"; do
    # 同时兼容 "notes"、"/notes"、"notes/" 这些写法。
    dir="${dir#/}"
    dir="${dir%/}"

    # 必须是目录下面的文件，notes-other/ 不会误匹配。
    if [[ "$path" == "$dir/"* ]]; then
      return 0
    fi
  done

  return 1
}

# ==============================
# 获取完整变更文件列表
# ==============================

changed_files=()

while IFS= read -r -d '' file; do
  changed_files+=("$file")
done < <(
  # --no-renames 很重要：
  # 如果 src/app.py 被移动到 notes/app.py，
  # 会被视为 src/app.py 删除 + notes/app.py 新增，
  # 因而仍然会触发重启。
  #
  # -z 使用 NUL 分隔，能够正确处理带空格等特殊字符的文件名。
  git diff \
    --name-only \
    --no-renames \
    -z \
    "$OLD_COMMIT" \
    "$NEW_COMMIT"
)

restart_required=false

echo "[deploy] 变更文件："

for file in "${changed_files[@]}"; do
  printf '  - %s\n' "$file"

  if ! is_no_restart_path "$file"; then
    restart_required=true
  fi
done

# ==============================
# 更新工程
# ==============================

# 与远端提交保持完全一致。
git reset --hard "$NEW_COMMIT"

echo "[deploy] 工程已更新："
echo "  $OLD_COMMIT"
echo "  -> $NEW_COMMIT"

# ==============================
# 按需重启服务
# ==============================

if [[ "$restart_required" == true ]]; then
  echo "[deploy] 检测到免重启目录之外的变更。"
  echo "[deploy] 正在重启 $SERVICE"

  sudo "$SYSTEMCTL" restart "$SERVICE"

  echo "[deploy] 服务重启完成。"
else
  echo "[deploy] 变更仅位于免重启目录，不重启服务。"
fi
```

这里使用 `git diff --name-only -z` 获取两个提交之间的文件路径；Git 官方文档说明，`--name-only` 只输出路径，`-z` 使用 NUL 分隔，适合安全处理特殊文件名。([Git][2])

设置权限：

```bash
sudo chown root:root /usr/local/bin/deploy-woboks-vibe-daily.sh
sudo chmod 755 /usr/local/bin/deploy-woboks-vibe-daily.sh
```

确认 `systemctl` 路径：

```bash
command -v systemctl
```

如果不是 `/usr/bin/systemctl`，同步修改脚本中的 `SYSTEMCTL`。

## 二、配置最小化 sudo 权限

部署用户不应该拥有完整的免密码 sudo，只允许它重启这一个服务。

假设服务器部署用户叫 `deploy`：

```bash
sudo visudo -f /etc/sudoers.d/woboks-vibe-daily-deploy
```

写入：

```sudoers
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart woboks-vibe-daily.service
```

然后设置权限：

```bash
sudo chmod 440 /etc/sudoers.d/woboks-vibe-daily-deploy
```

测试：

```bash
sudo -u deploy sudo /usr/bin/systemctl restart woboks-vibe-daily.service
```

`systemctl` 是 systemd 服务管理器的控制命令，能够对指定 unit 执行启动、停止和重启等操作。([自由桌面][3])

## 三、GitHub Actions Workflow

在项目中创建：

```text
.github/workflows/deploy.yml
```

内容：

```yaml
name: Deploy woboks-vibe-daily

on:
  push:
    branches:
      - main

  # 允许在 GitHub Actions 页面手动执行。
  workflow_dispatch:

# 避免同一个部署环境同时运行多个部署任务。
concurrency:
  group: production-woboks-vibe-daily
  cancel-in-progress: false

# 此 Workflow 不需要写仓库。
permissions:
  contents: read

jobs:
  deploy:
    name: Deploy to server
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Configure SSH
        env:
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          DEPLOY_KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
        run: |
          set -Eeuo pipefail

          install -m 700 -d "$HOME/.ssh"

          printf '%s\n' "$DEPLOY_SSH_KEY" \
            > "$HOME/.ssh/deploy_key"

          printf '%s\n' "$DEPLOY_KNOWN_HOSTS" \
            > "$HOME/.ssh/known_hosts"

          chmod 600 "$HOME/.ssh/deploy_key"
          chmod 644 "$HOME/.ssh/known_hosts"

      - name: Run deployment
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_PORT: ${{ secrets.DEPLOY_PORT }}
          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
        run: |
          set -Eeuo pipefail

          PORT="${DEPLOY_PORT:-22}"

          ssh \
            -i "$HOME/.ssh/deploy_key" \
            -p "$PORT" \
            -o BatchMode=yes \
            -o IdentitiesOnly=yes \
            -o StrictHostKeyChecking=yes \
            "$DEPLOY_USER@$DEPLOY_HOST" \
            "/usr/local/bin/deploy-woboks-vibe-daily.sh"
```

这个 Workflow 不需要 `actions/checkout`，因为 GitHub Runner 不处理工程内容，只负责调用服务器部署脚本。

## 四、配置 GitHub Secrets

进入仓库：

```text
Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

添加以下 Secrets：

| Secret               | 内容                        |
| -------------------- | ------------------------- |
| `DEPLOY_HOST`        | 服务器域名或 IP                 |
| `DEPLOY_PORT`        | SSH 端口，例如 `22`            |
| `DEPLOY_USER`        | 部署用户，例如 `deploy`          |
| `DEPLOY_SSH_KEY`     | GitHub Actions 登录服务器使用的私钥 |
| `DEPLOY_KNOWN_HOSTS` | 服务器 SSH Host Key          |

GitHub 官方建议敏感凭据通过 Actions Secrets 管理，并遵循最小权限原则。([GitHub Docs][1])

## 五、你实际需要两套 SSH 密钥

这里很容易混淆：

```text
GitHub Actions ──SSH Key A──> 你的服务器
你的服务器     ──SSH Key B──> GitHub 仓库
```

### Key A：Actions 登录服务器

在可信任的电脑上生成：

```bash
ssh-keygen \
  -t ed25519 \
  -C "github-actions-woboks-vibe-daily" \
  -f github-actions-woboks-vibe-daily \
  -N ""
```

生成两个文件：

```text
github-actions-woboks-vibe-daily      私钥
github-actions-woboks-vibe-daily.pub  公钥
```

私钥内容放入：

```text
DEPLOY_SSH_KEY
```

公钥放入服务器部署用户的：

```text
/home/deploy/.ssh/authorized_keys
```

可以进一步限制这把密钥只能运行部署脚本：

```text
command="/usr/local/bin/deploy-woboks-vibe-daily.sh",no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAAC3... github-actions-woboks-vibe-daily
```

这样即使这把密钥泄露，也不能通过它获得普通 SSH Shell。

### Key B：服务器读取 GitHub 仓库

如果服务器上的仓库已经可以正常执行：

```bash
git fetch origin main
```

这部分就已经配置完成。

否则建议为服务器创建一把**只读 Deploy Key**：

```bash
sudo -u deploy mkdir -p /home/deploy/.ssh

sudo -u deploy ssh-keygen \
  -t ed25519 \
  -C "woboks-vibe-daily-server" \
  -f /home/deploy/.ssh/woboks-vibe-daily-github \
  -N ""
```

将公钥：

```text
/home/deploy/.ssh/woboks-vibe-daily-github.pub
```

添加到 GitHub 仓库的：

```text
Settings
→ Deploy keys
→ Add deploy key
```

不勾选写权限。

GitHub Deploy Key 会把公钥直接绑定到单个仓库，私钥保留在服务器上，适合服务器自动读取私有仓库。([GitHub Docs][4])

服务器的 `/home/deploy/.ssh/config` 可以配置为：

```sshconfig
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/woboks-vibe-daily-github
    IdentitiesOnly yes
```

设置权限：

```bash
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/config
sudo chmod 600 /home/deploy/.ssh/woboks-vibe-daily-github
```

## 六、生成 `DEPLOY_KNOWN_HOSTS`

从可信任的电脑获取服务器 Host Key：

```bash
ssh-keyscan -H your-server.example.com
```

自定义端口：

```bash
ssh-keyscan -p 2222 -H your-server.example.com
```

把输出完整放入：

```text
DEPLOY_KNOWN_HOSTS
```

最好同时核对服务器显示的 Host Key 指纹，避免把未经验证的主机密钥直接加入 GitHub Actions。

## 七、初始化服务器仓库

假设部署用户是 `deploy`：

```bash
sudo mkdir -p /srv/woboks-vibe-daily
sudo chown deploy:deploy /srv/woboks-vibe-daily
```

首次克隆：

```bash
sudo -u deploy git clone \
  --branch main \
  git@github.com:YOUR_NAME/YOUR_REPOSITORY.git \
  /srv/woboks-vibe-daily
```

测试完整部署：

```bash
sudo -u deploy /usr/local/bin/deploy-woboks-vibe-daily.sh
```

## 最终判断效果

| 变更内容                             | 是否拉取 | 是否重启 |
| -------------------------------- | ---: | ---: |
| `notes/today.md`                 |    是 |    否 |
| `skill/example.md`               |    是 |    否 |
| `notes/a.md` 和 `skill/b.md`      |    是 |    否 |
| `notes/a.md` 和 `src/app.py`      |    是 |    是 |
| `README.md`                      |    是 |    是 |
| 删除 `src/app.py`                  |    是 |    是 |
| 把 `src/app.py` 移到 `notes/app.py` |    是 |    是 |
| 没有新提交                            |    否 |    否 |

以后增加免重启目录，只修改数组：

```bash
NO_RESTART_DIRS=(
  "notes"
  "skill"
  "docs"
  "prompts"
)
```

**Actions 只负责敲门，服务器先比较完整差异、再拉代码，发现免重启目录之外的变化才重启服务。**

[1]: https://docs.github.com/actions/security-guides/using-secrets-in-github-actions "Using secrets in GitHub Actions - GitHub Docs"
[2]: https://git-scm.com/docs/git-diff "Git - git-diff Documentation"
[3]: https://www.freedesktop.org/software/systemd/man/systemctl.html "systemctl"
[4]: https://docs.github.com/v3/guides/managing-deploy-keys "Managing deploy keys - GitHub Docs"
