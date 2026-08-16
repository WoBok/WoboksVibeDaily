---
title: "uv - 包管理核心手册"
date: "2026-08-16"
summary: "梳理 uv 的 Python 版本管理、依赖锁定、虚拟环境、项目运行、pip 兼容模式及缓存维护等核心机制与命令。"
category: "Inbox"
tags:
  - "uv"
  - "Python"
  - "包管理"
  - "依赖管理"
  - "虚拟环境"
---

**核心工作原理**

* Python 本身统一下载并存放在全局，每个项目只在本地生成轻量的 `.venv` 独立环境来关联它，不占重复空间。
* **依赖配置与锁定机制**：
    * `pyproject.toml` 记录你主动要求安装的包和大致版本范围。
    * `uv.lock` 自动记录所有包以及它们背后所有依赖的具体版本号，确保换到任何一台电脑上装出来的环境都完全一样。
    * **`uv sync` 同步逻辑**：存在 uv.lock 时，严格基于锁定文件安装完全一致的版本；不存在 uv.lock 时，自动解析 pyproject.toml 中的依赖关系，生成 uv.lock 并完成安装。

* 所有第三方包统一下载保存在全局，项目安装时直接快速引用到 `.venv`，不占双份磁盘且实现秒级安装。
* 运行 `uv run` 或 `uv sync` 时，uv 会自动检查或创建 `.venv`，不需要手动执行激活（activate）命令。

---

**Python 版本管理**

* `uv python install <version>`：安装指定 Python 版本（如 `uv python install 3.xx`）
* `uv python list`：列出本机已安装和所有可安装的 Python 版本
* `uv python pin <version>`：为当前目录锁定 Python 版本（生成 `.python-version`）

**现代项目与依赖管理**

* `uv init [dir]`：初始化新项目（生成 `pyproject.toml`）
* `uv add <pkg>`：添加依赖并自动安装（自动更新 `pyproject.toml` 和 `uv.lock`）
* `uv add --dev <pkg>`：添加开发依赖
* `uv remove <pkg>`：移除依赖并更新环境与配置文件
* `uv lock`：仅解析依赖并更新 `uv.lock`，不实际安装
* `uv sync`：根据 `uv.lock` 完全同步环境（补齐缺失、删除多余包）

**代码运行与即席工具**

* `uv run <script.py>`：在项目隔离环境中运行脚本（无需手动激活虚拟环境）
* `uv run <cmd>`：在项目环境中运行命令行命令（如 `uv run pytest`）
* `uvx <tool>`：在临时隔离环境中运行 CLI 工具（如 `uvx ruff check .`，不污染全局环境）

**pip 兼容模式（用于传统 requirements.txt 项目）**

* `uv venv`：在当前目录快速创建虚拟环境 `.venv`
* `uv pip install <pkg>`：极速替代 `pip install`
* `uv pip install -r requirements.txt`：极速安装依赖清单
* `uv pip compile requirements.in -o requirements.txt`：锁定依赖版本
* `uv pip freeze`：输出当前环境已安装的包列表

**环境与缓存维护**

* `uv cache clean`：清理全局下载与构建缓存

---

全局缓存底层与包、项目就地链接 `.venv`，靠 `uv.lock` 锁死版本并自动接管运行。
