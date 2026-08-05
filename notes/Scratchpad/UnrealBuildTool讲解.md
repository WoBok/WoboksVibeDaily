# UnrealBuildTool (UBT) 核心讲解

## 一、它是什么

**UBT 是虚幻引擎自己写的 C# 构建系统**，负责把海量 C++ 代码编译成引擎/游戏的可执行文件。

它不是编译器，而是**编译的指挥官**：分析依赖 → 生成编译命令 → 调用 MSVC/Clang → 链接。

> 类比：CMake 之于普通 C++ 项目，UBT 之于 UE。但 UBT 更"重"，它内置了模块系统、代码生成、平台抽象。

**为什么 UE 不用 CMake/VS 工程？**
- UE 有几千万行代码、上千个模块，需要极致的增量编译和并行调度
- 需要跨 20+ 平台统一配置
- 需要在编译前跑代码生成（UHT）
- 需要用 C# 写"可编程的构建规则"，而不是死板的配置文件

## 二、三个核心概念

### 1. Module（模块）—— 代码的组织单位

UE 中所有 C++ 代码都必须属于某个模块。一个模块 = 一个文件夹 + 一个 `XXX.Build.cs`。

编译产物是一个 DLL（Editor 下）或被静态链接进最终 exe（打包时）。

```
Source/
  MyGame/
    MyGame.Build.cs      ← 模块的构建规则
    Public/              ← 对外暴露的头文件
    Private/             ← 内部实现
```

### 2. Target（目标）—— 最终产物的定义

一个 Target = 一个最终可执行文件，由 `XXX.Target.cs` 定义。

**Target 是工程级的，只放在工程的 `Source/` 下。** 模块和插件都没有 `.Target.cs`。

> Target 是"我要造一台什么车"，Module 是"我提供一个零件"，插件是"零件供应商"。

`TargetType` 枚举类型：

| Type | 产物 | 说明 |
|---|---|---|
| `Game` | 游戏可执行文件 | 打包发布用，客户端+服务器逻辑都在 |
| `Editor` | 编辑器 | 日常开发用（`MyGameEditor.Target.cs`） |
| `Client` | 纯客户端 | 剥离专用服务器代码，`WITH_SERVER_CODE=0` |
| `Server` | 专用服务器 | 无渲染、无音频、无输入 |
| `Program` | 独立工具 | 不加载引擎完整运行时，如 UnrealFrontend |

### 3. Build Configuration（编译配置）—— 优化与调试信息的档位

同一个 Target 可以用不同"档位"编译：调试信息越多、优化越少，越好调试但越慢。

**它不对应任何文件**，是编译时传给 UBT 的命令行参数 —— 也就是 Rider / VS 顶部那个下拉框里选的东西：

```
Rider / VS 配置下拉：
  DebugGame Editor | Win64
  Development Editor | Win64   ← 日常开发常用
  Shipping | Win64
  └ Configuration ┘ └Platform┘
```

| 配置 | 引擎代码 | 游戏代码 | 用途 |
|---|---|---|---|
| `Debug` | 调试 | 调试 | 调引擎源码 |
| `DebugGame` | 优化 | 调试 | **调游戏逻辑（常用）** |
| `Development` | 优化 | 优化 | **日常开发（默认）** |
| `Test` | 优化 | 优化 | 性能测试，保留部分统计 |
| `Shipping` | 最优化 | 最优化 | 发布，剥离日志和控制台 |

**完整构建指令三要素**：`Target + Platform + Configuration`

```
UnrealBuildTool.exe  MyGameEditor  Win64  Development  -Project="...\MyGame.uproject"
                     └─ Target ──┘ └平台┘ └Config────┘
```

| 要素 | 由什么决定 |
|---|---|
| **Target** | `.Target.cs` 文件（磁盘上真实存在） |
| **Platform** | 命令行参数 / IDE 下拉框 |
| **Configuration** | 命令行参数 / IDE 下拉框 |


## 三、Build.cs 详解

```csharp
using UnrealBuildTool;

public class MyGame : ModuleRules
{
    public MyGame(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        // 公有依赖：本模块的 Public 头文件里用到的模块
        // 会传递给依赖本模块的其他模块
        PublicDependencyModuleNames.AddRange(new string[] {
            "Core", "CoreUObject", "Engine", "InputCore"
        });

        // 私有依赖：只在 Private 里用到，不传递
        PrivateDependencyModuleNames.AddRange(new string[] {
            "Slate", "SlateCore", "UMG"
        });

        // 仅编辑器下依赖
        if (Target.bBuildEditor)
        {
            PrivateDependencyModuleNames.Add("UnrealEd");
        }
    }
}
```

### Public vs Private 依赖

- **Public**：依赖会**传递**。A 的 Public 依赖 B，那么依赖 A 的 C 也能直接用 B。
- **Private**：依赖**不传递**，编译更快，耦合更低。

**原则：能用 Private 就用 Private。** 只有在你的 `Public/` 头文件里 `#include` 了对方的头，才放 Public。

### 其他常用字段

```csharp
PublicIncludePaths.Add("路径");          // 额外头文件搜索路径
PrivateIncludePaths.Add("路径");
PublicAdditionalLibraries.Add("xxx.lib"); // 第三方静态库
PublicSystemLibraries.Add("ws2_32.lib");  // 系统库
PublicDefinitions.Add("MY_MACRO=1");      // 预处理宏
RuntimeDependencies.Add("$(BinaryDir)/xxx.dll"); // 打包时一起拷贝
```


## 四、Target.cs 详解

```csharp
using UnrealBuildTool;

public class MyGameTarget : TargetRules   // 类名 = 文件名去掉 .Target.cs 再加 Target
{
    // TargetInfo 里装着本次传入的 Platform 和 Configuration
    public MyGameTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;              // 产物类型：游戏 exe

        // 下面两行都是兼容性开关：声明"这份代码按哪个引擎版本的规矩写"，
        // 避免升引擎后默认行为突变。新建工程填当前引擎版本即可
        DefaultBuildSettings = BuildSettingsVersion.V5;              // 编译开关的默认值基线
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;   // 引擎公共头的 include 顺序规则

        ExtraModuleNames.Add("MyGame");      // 本 Target 包含哪些模块（入口模块）
    }
}
```

### 模块是怎么进入一个 Target 的

| 代码来源 | 入队方式 |
|---|---|
| 工程自己的模块 | `Target.cs` 里 `ExtraModuleNames.Add("MyGame")` |
| 插件的模块 | `.uproject` 的 `Plugins` 里启用（工程内置插件默认自动启用） |
| 间接依赖的模块 | 别人在 `Build.cs` 的 `DependencyModuleNames` 里写了它 |

所以 `ExtraModuleNames` 里看不到插件是正常的 —— 插件走的是另一条路径。

### LinkType：模块最终怎么"拼装"成产物

**LinkType 决定的是：编译出的这些模块，是各自保持独立 DLL，还是全部合并进一个 exe。**

- **Modular（模块化）**：模块各自是独立 DLL，运行时动态加载。
  **Editor 必须用** —— 只有模块独立，才能单独重编一个 DLL 再换回去，这就是热重载 / Live Coding 的原理。代价是启动慢、文件散乱。
- **Monolithic（单体）**：所有模块静态链接进一个 exe。
  **打包发布默认用** —— 启动快、跨模块调用可被内联、只需分发一个文件。代价是改一行就要整体重链，无法热重载。

一般不用手动设，UBT 按 `Type` 自动选：`Editor` → Modular，其余 → Monolithic。


## 五、完整构建流程

```
1. 读取 .uproject / .uplugin
        ↓  找到所有模块
2. 解析所有 Build.cs / Target.cs（C# 动态编译执行）
        ↓  构建模块依赖图
3. 运行 UnrealHeaderTool (UHT)
        ↓  扫描带 UCLASS/USTRUCT/UFUNCTION 的头文件
        ↓  生成 .generated.h / .gen.cpp（反射代码）
4. 生成 PCH + Unity 文件（合并 cpp 加速编译）
        ↓
5. 调用编译器（MSVC / Clang）并行编译
        ↓
6. 链接成 DLL / EXE
```

### UHT（UnrealHeaderTool）

UBT 在编译**之前**调用 UHT。UHT 扫描你的头文件，把 `UCLASS()`、`UPROPERTY()` 这些宏解析掉，生成 C++ 反射代码。

由此带来两条硬性规则：
- 每个含 `UCLASS` 的头文件必须 `#include "XXX.generated.h"`（且必须放在**最后一个** include）
- 改了 `UPROPERTY` 就必须重新编译，不能只热重载


## 六、加速机制

### 1. Unity Build（合并编译单元）
把多个 `.cpp` 拼进一个大文件一起编译，减少重复解析头文件的开销。

**副作用**：容易掩盖"漏写 include"的错误——你的 cpp 借用了同批次别人的 include，单独编译时就炸了。

关闭（用于排查）：`bUseUnityBuild = false;`

### 2. PCH（预编译头）
把公共头文件预先编译好，避免重复编译。

推荐：`PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;`

### 3. IWYU（Include What You Use）
UE5 推行的原则：**每个文件只 include 自己真正用到的东西**，不要依赖 `Engine.h` 这种大杂烩。

好处：编译更快、增量编译影响面更小。


## 七、常用命令

引擎目录下 `Engine/Build/BatchFiles/`：

```bash
Build.bat MyGameEditor Win64 Development -Project="D:\Path\MyGame.uproject" -WaitMutex
```

```bash
Rebuild.bat MyGameEditor Win64 Development -Project="D:\Path\MyGame.uproject"
```

```bash
Clean.bat MyGameEditor Win64 Development -Project="D:\Path\MyGame.uproject"
```

重新生成 VS 工程文件（右键 .uproject 的"Generate Visual Studio project files"就是调它）：

```bash
GenerateProjectFiles.bat
```

打包（UAT 内部会调用 UBT）：

```bash
RunUAT.bat BuildCookRun -project="D:\Path\MyGame.uproject" -noP4 -platform=Win64 -clientconfig=Shipping -cook -build -stage -pak -archive
```

---

> **UBT 用 C# 脚本（Build.cs / Target.cs）描述"谁依赖谁、要编成什么"，先调 UHT 生成反射代码，再用 Unity Build + PCH 加速，最后驱动原生编译器产出 DLL 或 EXE。**
