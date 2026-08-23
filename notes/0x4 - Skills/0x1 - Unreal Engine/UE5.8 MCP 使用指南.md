---
title: "UE5.8 MCP 使用指南"
date: "2026-08-04"
summary: "涵盖 UE5.8 Unreal MCP 的插件启用、服务器与客户端配置、控制台命令、设置项、内置工具集及 Python/C++ 自定义工具开发。"
category: "Unreal Engine"
tags:
  - "Unreal Engine"
  - "UE5.8"
  - "MCP"
  - "编辑器配置"
  - "自定义工具"
---

> 参考：[Epic 官方文档](https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor)

## 一、接入步骤

### 1. 启用插件

`Edit > Plugins` 中勾选，然后重启编辑器：

- **Unreal MCP** —— 服务器本体
- **All Toolsets** —— 加载全部默认工具集
- **Toolset Registry** —— 依赖项，会自动启用

### 2. 开启服务器

`Edit > Editor Preferences > General > Model Context Protocol`，勾选 **Auto Start Server**。默认地址：

```
http://127.0.0.1:8000/mcp
```

不想自启动，就在编辑器控制台手动执行 `ModelContextProtocol.StartServer`。

### 3. 生成客户端配置

编辑器控制台（`~` 键）执行：

```
ModelContextProtocol.GenerateClientConfig ClaudeCode
```

客户端名可选：`ClaudeCode`、`Cursor`、`VSCode`、`Gemini`、`Codex`、`All`。要一次性配置多个 Agent，用 `All`。

命令会在**项目根目录**生成 `.mcp.json`：

```json
{
  "mcpServers": {
    "unreal-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:8000/mcp"
    }
  }
}
```

> 如果用源码引擎打开项目，文件可能生成在**引擎根目录**而非工程目录，拷贝到工程目录即可。

### 4. 启动 Agent

必须**从项目根目录**（即 `.mcp.json` 所在目录）启动 CLI，否则读不到配置：

```bash
cd D:/YourProject && claude
```

服务器跑在编辑器进程内，**全程保持编辑器打开**。连上后让 Agent 列一下工具，能看到 `unreal-mcp` 提供的工具即为成功。

## 二、控制台命令

| 命令 | 作用 |
|---|---|
| `ModelContextProtocol.StartServer [port]` | 启动服务器，可选覆盖端口 |
| `ModelContextProtocol.StopServer` | 停止服务器，关闭所有会话 |
| `ModelContextProtocol.RefreshTools` | 新增/修改工具后重新扫描 |
| `ModelContextProtocol.GenerateClientConfig <客户端\|All>` | 生成客户端配置 |

命令行启动参数（适合批处理、快捷方式）：

```
-ModelContextProtocolStartServer
-ModelContextProtocolPort=N
```

## 三、设置项

### Editor Preferences

| 设置 | 默认值 | 说明 |
|---|---|---|
| Auto Start Server | `false` | 编辑器启动时自动开启服务 |
| Server Port Number | `8000` | 监听端口（绑定 127.0.0.1） |
| Server URL Path | `/mcp` | 服务路径 |
| Enable Tool Search | `true` | 让 Agent 按需检索工具，而非一次性加载全部 schema，显著省上下文。建议保持开启 |

### 控制台变量

| CVar | 默认值 | 说明 |
|---|---|---|
| `ModelContextProtocol.WrapPODToolResultsInObject` | `true` | 把基础类型返回值包装成对象 |
| `ModelContextProtocol.AudioResultOggFormat` | `false` | 音频结果用 Ogg 格式 |
| `ModelContextProtocol.ProgressIntervalSeconds` | `1.0` | 进度上报间隔（秒） |
| `ModelContextProtocol.PaginationPageSize` | `0` | 分页大小，0 为不分页 |
| `ModelContextProtocol.EnableAnalytics` | `true` | 上报使用分析数据 |

## 四、随附工具集

启用 **All Toolsets** 后可用：

| 工具集 | 用途 |
|---|---|
| **SceneTools** | 场景级操作 |
| **ActorTools** | Actor 的变换、标签、父子层级、组件 |
| **MaterialInstanceTools** | 材质实例参数 |
| **ObjectTools** | 通用 UObject 属性读写 |
| **AttributeSetToolset** | 位于 `GASToolsets` 插件，可作为 C++ 工具集的参考实现 |

具体工具名官方未逐一列出，连上后让 Agent 列出工具列表即可。

## 五、编写自定义工具

工具由 Toolset Registry 通过反射自动发现，编辑器下无需手动注册。

### Python

把 `.py` 模块放进任意插件的 `Content/Python/` 目录：

```python
import unreal
import toolset_registry
from toolset_registry.toolsets.core.utils import require_editable

@unreal.uclass()
class ActorTools(unreal.ToolsetDefinition):
    """Provides tools for inspecting and modifying actors, including
    their transforms, labels, parent-child relationships, and components."""

    # 在此定义要暴露为 MCP 工具的方法
```

类的 docstring 会作为工具集描述交给模型，务必写清楚它能做什么。

### C++

继承 `UToolsetDefinition`，把要暴露的方法标记为 `AICallable`：

```cpp
UCLASS(BlueprintType, Hidden)
class UMyToolset : public UToolsetDefinition
{
    GENERATED_BODY()

public:
    UFUNCTION(meta = (AICallable))
    static FString DoSomething(const FString& Param);
};
```

要点：

- 类必须标记 `UCLASS(BlueprintType, Hidden)`
- 暴露的方法是 **static** `UFUNCTION`，带 `meta = (AICallable)`
- 参数和返回值类型由反射自动转成 MCP 的 JSON Schema
- 完整示例见 `GASToolsets` 插件的 `UAttributeSetToolset`

> Live Coding 不会传播新增的 `UFUNCTION`，**加新工具必须重启编辑器**；只改函数体可以热重载。改完记得跑一次 `ModelContextProtocol.RefreshTools`。
