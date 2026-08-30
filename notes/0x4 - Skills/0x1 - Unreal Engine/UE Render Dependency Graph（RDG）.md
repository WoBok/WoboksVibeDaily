---
title: "UE Render Dependency Graph（RDG）"
date: "2026-08-30"
summary: "系统梳理 UE RDG 的数据流建模、Pass 与资源访问契约、编译执行流程、生命周期、同步裁剪、异步计算及 Compute Pass 实践。"
category: "Unreal Engine"
tags:
  - "Unreal Engine"
  - "RDG"
  - "渲染管线"
  - "Compute Shader"
  - "GPU 资源管理"
  - "Async Compute"
---

## 1. RDG 最核心的是什么

**RDG 是一个渲染任务编译器：开发者声明每个 Pass 读什么、写什么、执行什么，RDG 在看到完整图后，统一安排资源生命周期、Pass 依赖、Barrier、裁剪与并行。**

传统 RHI 代码更像逐条发命令：

```text
创建资源 → 切换到 UAV → Dispatch → 切换到 SRV → Draw → 释放资源
```

RDG 代码描述的是数据流：

```text
Pass A 写中间纹理 → Pass B 读取中间纹理 → Pass C 写入最终目标
```

这意味着职责发生了变化：

| 开发者负责 | RDG 负责 |
|---|---|
| 描述资源、真实读写方式和 GPU 工作 | 从资源访问建立依赖 |
| 保证 Shader 算法、参数和访问范围正确 | 推导资源状态与 Barrier |
| 明确图内、图外和跨帧资源的所有权 | 管理图内临时资源的生命周期 |
| 把结果接到可观察的输出 | 裁剪无用工作并规划可用的并行 |

RDG 不替代 Shader，也不替代 RHI。**RDG 管“工作怎样衔接”，Pass 的执行代码仍通过 RHI 记录 Draw、Dispatch 或 Copy 命令。**


## 2. Pass 与 Resource 构成数据流图

RDG 图由两类要素组成：

- **Pass**：Raster、Compute、Async Compute、Copy 等 GPU 工作；
- **Resource**：Texture、Buffer 及其 SRV、UAV、Render Target、Copy 等访问。

**Pass 是 RDG 调度、同步和资源状态转换的基本单位，由执行类型、资源访问契约和执行 Lambda 组成。** 执行类型说明它记录 Raster、Compute 还是 Copy 工作；参数结构声明它读写哪些资源；Lambda 记录真正的 Draw、Dispatch 或 Copy 命令。一个 Pass 不等于一次 Draw Call，它可以包含多条访问方式兼容的 GPU 命令；当中间结果要被下一阶段读取、资源访问方式发生变化，或工作需要切换管线/队列时，才应形成新的 Pass 边界。

例如：

```text
SourceTexture
     │ SRV 读
     ▼
Filter Pass
     │ UAV 写
     ▼
FilteredTexture
     │ SRV 读
     ▼
Composite Pass
     │ RTV 写
     ▼
OutputTexture
```

Pass 参数结构既是 Shader 的绑定接口，也是 RDG 的资源访问契约：

```cpp
BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, SourceTexture)
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2D<float4>, ResultTexture)
END_SHADER_PARAMETER_STRUCT()
```

参数类型表达读取、UAV 写入或 Render Target 输出等访问方式，参数值则指向本次实际使用的 RDG 资源。当一个 Pass 的输出被另一个 Pass 作为输入时，同一个资源便把生产者与消费者连接起来：

```text
Filter Pass ──UAV 写──► FilteredTexture ──SRV 读──► Composite Pass
```

RDG 汇总所有 Pass 的访问契约、执行类型与最终输出，据此完成：

- 建立生产者—消费者依赖并约束执行顺序；
- 插入必要的 Transition、UAV Barrier 与跨队列 Fence；
- 计算临时资源的有效生命周期并复用内存；
- 从最终输出反向裁剪无效的 Pass 与资源。

---

## 3. RDG 如何运作：Setup、Compile、Execute

### 3.1 Setup：描述本次图

从创建 `FRDGBuilder` 到调用 `Execute()` 之前，代码主要做四件事：

1. 创建图内资源，或注册图外资源；
2. 用 `GraphBuilder.AllocParameters` 分配并填写 Pass 参数；
3. 添加 Pass；
4. 声明上传、复制、提取等工作。

`CreateTexture`、`CreateBuffer` 通常只创建资源描述与图内句柄；`AddPass` 只记录 Pass。此时底层资源未必已经分配，Pass Lambda 也尚未运行。

官方把 RDG 称为 immediate-mode API，是指可以用普通的顺序 C++ 控制流即时构建本帧图；**它不表示 `AddPass` 会立即执行 GPU 工作。**

### 3.2 Compile：用全图信息制定执行方案

`Execute()` 首先编译图，主要包括：

- 校验 Pass 与资源声明；
- 建立生产者—消费者关系并裁剪无用工作；
- 计算临时资源生命周期，安排分配与内存复用；
- 推导子资源状态、Barrier 和跨队列同步；
- 规划兼容的 Render Pass 合并、CPU 并行录制和 Async Compute 区间。

不是每张图都会触发全部优化；结果取决于资源依赖、Pass flags、平台能力和运行配置。

### 3.3 Execute：记录真正的 RHI 命令

RDG 按编译结果调用保留下来的 Pass Lambda。Lambda 应尽量只做命令录制：

```cpp
SetGraphicsPipelineState(RHICmdList, GraphicsPSOInit, 0);
SetShaderParameters(RHICmdList, PixelShader, PixelShader.GetPixelShader(), *Parameters);
RHICmdList.DrawPrimitive(0, 1, 1);
```

Pass 可能延迟执行、并行录制，或因裁剪而不执行。因此：

- 不要引用捕获会在 Setup 后失效的栈对象；
- 参数传入 `AddPass` 后不要再修改；
- 不要在 Lambda 内放置必须发生的游戏逻辑或共享 CPU 副作用；
- 除非确有需要，避免要求 `FRHICommandListImmediate`，以免失去并行录制机会。

一次 `Execute()` 是当前 `FRDGBuilder` 的图边界，但不等于立即 Flush GPU。不同 Builder 是不同的图，不会跨图联合分析；资源跨图使用必须显式导出和重新注册。

---

## 4. 资源与访问契约

### 4.1 三层信息不能混为一谈

```text
Resource Desc  ：资源多大、什么格式、允许哪些用途
View           ：以 SRV/UAV 和什么格式解释资源
Pass Parameters：这个 Pass 实际怎样访问资源
```

创建了一个 UAV View，不代表 RDG 已经知道某个 Pass 会写它。只有当该 UAV 出现在这个 Pass 的参数结构中，访问才进入依赖图。

参数结构中的普通常量、Sampler 主要用于 Shader 绑定；`SHADER_PARAMETER_RDG_*` 与 `RENDER_TARGET_BINDING_SLOTS()` 还承担资源依赖声明。C++ 成员名、HLSL 参数名、资源类型与 View 格式必须一致。

### 4.2 Transient 与 External

- **Transient**：图内创建、仅在当前图使用。RDG 可以延迟分配，并让生命周期不重叠的资源复用物理内存。
- **External**：生命周期跨越图边界。图外资源进入图时需要 Register；图内资源离开图时需要 Extract。

通用流程是：

```text
图外已有资源 ──Register──► 当前 RDG 图
当前图创建资源 ──Extract──► 图外持有 ──下一张图重新 Register──► 后续使用
```

`FRDGTextureRef`、`FRDGBufferRef` 及其 View 只在当前 Builder 生命周期内有效，不应保存到 UObject、模块成员或下一帧。跨帧历史资源应由图外的池化资源持有。

Register 会让资源从图开始时就处于外部生命周期，Extract 会把它延长到图结束；两者都会减少内存别名复用空间。因此，**能留在一张图内的中间结果就不要过早外部化。**

---

## 5. 一个最小但完整的 Compute Pass

### 5.1 注册插件 Shader 目录

插件通常应在 Shader 编译前加载，例如在 `.uplugin` 中将渲染模块的 `LoadingPhase` 设为 `PostConfigInit`。模块启动时建立虚拟路径映射：

```cpp
#include "Interfaces/IPluginManager.h"
#include "Misc/Paths.h"
#include "ShaderCore.h"

void FExampleRenderingModule::StartupModule()
{
    const TSharedPtr<IPlugin> Plugin =
        IPluginManager::Get().FindPlugin(TEXT("ExampleRendering"));
    check(Plugin.IsValid());

    const FString ShaderDirectory =
        FPaths::Combine(Plugin->GetBaseDir(), TEXT("Shaders"));

    AddShaderSourceDirectoryMapping(TEXT("/ExampleRendering"), ShaderDirectory);
}
```

模块至少需要 `RenderCore`、`RHI` 和 `Projects` 依赖。

### 5.2 编写 `.usf`

文件：`Shaders/Private/InvertTexture.usf`

```hlsl
#include "/Engine/Public/Platform.ush"

Texture2D<float4> SourceTexture;
RWTexture2D<float4> ResultTexture;
int2 TextureExtent;

[numthreads(8, 8, 1)]
void MainCS(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint2 Pixel = DispatchThreadId.xy;
    if (any(Pixel >= (uint2)TextureExtent))
    {
        return;
    }

    float4 SourceColor = SourceTexture.Load(int3(Pixel, 0));
    ResultTexture[Pixel] = float4(1.0 - SourceColor.rgb, SourceColor.a);
}
```

边界判断不可省略，因为向上取整后的线程组可能覆盖纹理范围之外的线程。

### 5.3 声明并注册 Global Shader

```cpp
#include "DataDrivenShaderPlatformInfo.h"
#include "GlobalShader.h"
#include "RenderGraphBuilder.h"
#include "RenderGraphUtils.h"
#include "ShaderParameterStruct.h"

class FInvertTextureCS : public FGlobalShader
{
public:
    DECLARE_GLOBAL_SHADER(FInvertTextureCS);
    SHADER_USE_PARAMETER_STRUCT(FInvertTextureCS, FGlobalShader);

    BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
        SHADER_PARAMETER(FIntPoint, TextureExtent)
        SHADER_PARAMETER_RDG_TEXTURE(Texture2D, SourceTexture)
        SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2D<float4>, ResultTexture)
    END_SHADER_PARAMETER_STRUCT()

    static bool ShouldCompilePermutation(
        const FGlobalShaderPermutationParameters& Parameters)
    {
        return IsFeatureLevelSupported(
            Parameters.Platform,
            ERHIFeatureLevel::SM5);
    }
};

IMPLEMENT_GLOBAL_SHADER(
    FInvertTextureCS,
    "/ExampleRendering/Private/InvertTexture.usf",
    "MainCS",
    SF_Compute);
```

`DECLARE_GLOBAL_SHADER` 声明类型，`IMPLEMENT_GLOBAL_SHADER` 把 C++ 类型、`.usf`、入口函数和 Shader 阶段关联起来。虚拟路径必须与前面的目录映射一致。

### 5.4 创建资源并添加 Pass

```cpp
FRDGTextureRef AddInvertTexturePass(
    FRDGBuilder& GraphBuilder,
    FRDGTextureRef SourceTexture,
    FIntPoint Extent)
{
    FRDGTextureDesc ResultDesc = FRDGTextureDesc::Create2D(
        Extent,
        PF_FloatRGBA,
        FClearValueBinding::None,
        TexCreate_ShaderResource | TexCreate_UAV);

    FRDGTextureRef ResultTexture = GraphBuilder.CreateTexture(
        ResultDesc,
        TEXT("InvertTexture.Result"));

    FInvertTextureCS::FParameters* Parameters =
        GraphBuilder.AllocParameters<FInvertTextureCS::FParameters>();

    Parameters->TextureExtent = Extent;
    Parameters->SourceTexture = SourceTexture;
    Parameters->ResultTexture = GraphBuilder.CreateUAV(ResultTexture);

    TShaderMapRef<FInvertTextureCS> ComputeShader(
        GetGlobalShaderMap(GMaxRHIFeatureLevel));

    FComputeShaderUtils::AddPass(
        GraphBuilder,
        RDG_EVENT_NAME("InvertTexture"),
        ERDGPassFlags::Compute,
        ComputeShader,
        Parameters,
        FComputeShaderUtils::GetGroupCount(Extent, FIntPoint(8, 8)));

    return ResultTexture;
}
```

数据流的完整表达：

```text
SourceTexture ──SRV 读──► InvertTexture Pass ──UAV 写──► ResultTexture
```

调用方必须继续消费结果：

```cpp
FRDGBuilder GraphBuilder(RHICmdList);

FRDGTextureRef SourceTexture = /* 外部注册，或由前一个 Pass 产生 */;
FRDGTextureRef OutputTexture = /* 已注册的外部输出目标 */;

FRDGTextureRef ResultTexture =
    AddInvertTexturePass(GraphBuilder, SourceTexture, Extent);

AddCopyTexturePass(GraphBuilder, ResultTexture, OutputTexture);
GraphBuilder.Execute();
```

若 `ResultTexture` 没有后续消费者、没有被提取，也没有流向其他可观察输出，Compute Pass 可能被裁剪。这相当于编译器的死代码消除。

## 6. 依赖如何变成 Barrier、生命周期与裁剪

考虑一条常见链路：

```text
Pass A：Compute 读取深度，UAV 写 MaskTexture
Pass B：Raster 读取 MaskTexture，RTV 写 SceneColor
Pass C：Copy 读取 SceneColor，写入外部输出
```

正确声明后，RDG 拥有以下事实：

| Pass | 资源 | 访问方式 |
|---|---|---|
| A | `DepthTexture` | SRV 读 |
| A | `MaskTexture` | UAV 写 |
| B | `MaskTexture` | SRV 读 |
| B | `SceneColor` | RTV 写 |
| C | `SceneColor` | CopySrc 读 |
| C | 外部输出 | CopyDest 写 |

RDG 可以由此确定性地推导：

```text
执行约束：A → B → C
资源状态：MaskTexture 从 UAV 写转换为 SRV 读
资源状态：SceneColor 从 RTV 写转换为 CopySrc 读
生命周期：MaskTexture 从 A 首次使用持续到 B 最后使用
生命周期：SceneColor 从 B 首次使用持续到 C 最后使用
图根：C 写入外部输出，因此 B、A 都能沿依赖链追溯到有效结果
```

所谓“自动管理”不是 RDG 猜测 Lambda 做了什么，而是对访问契约做推导。漏报资源会破坏正确性；多报未使用资源则会制造虚假依赖、延长生命周期并限制并行。

RDG 通常从具有外部可见结果的图根反向保留生产者。常见图根包括写入外部资源、请求资源提取，以及确实需要 `NeverCull` 的副作用 Pass。Pass 意外消失时，应先检查输出链是否断开，而不是直接添加 `NeverCull`。

---

## 7. Pass 类型、边界与 Async Compute

`ERDGPassFlags` 表示 Pass 在哪类管线记录什么工作：

| 类型 | 典型工作 | 关键声明 |
|---|---|---|
| `Raster` | Draw | Render Target / Depth Stencil 绑定 |
| `Compute` | 图形队列上的 Dispatch | SRV、UAV、Dispatch 尺寸 |
| `AsyncCompute` | 允许进入异步计算队列的 Dispatch | 与 Graphics 的生产者、消费者依赖 |
| `Copy` | 资源复制与 Readback Copy | CopySrc、CopyDest |

划分 Pass 时，应以资源访问阶段为依据：当上一阶段的输出被下一阶段读取、访问方式发生变化，或工作需要切换管线/队列时，应形成清晰的 Pass 边界。

Raster Pass 还必须准确选择 Load Action：

- `ELoad`：保留并读取目标原有内容；
- `EClear`：开始时清除目标；
- `ENoAction`：不依赖原内容，且后续写入会覆盖所需区域。

Load Action 会直接影响结果、带宽和依赖，不是无关紧要的初始化选项。

`AsyncCompute` 的含义是“允许 RDG 调度到异步计算队列”，不是“保证更快”：

```text
Graphics 生产者 ──Fence──► Async Compute ──Fence──► Graphics 消费者
```

只有当中间存在足够的、依赖独立的 Graphics 工作可与 Compute 重叠时，才可能获得收益。依赖太紧、资源竞争或带宽压力过大时，Fence 成本可能抵消收益；必须通过 RDG Insights 与 GPU Profiling 验证。

---

## 8. RDG 带来的核心优化，以及成立条件

RDG 的优化都来自同一个前提：**它在执行前看到了完整且准确的数据流。**

| 能力 | 为什么能做到 | 主要收益 |
|---|---|---|
| Pass / Resource 裁剪 | 能从图根反向判断哪些结果不可观察 | 避免无用 GPU 工作与分配 |
| Transient 生命周期分析与内存别名 | 知道每个临时资源的首次和最后一次使用 | 降低显存峰值 |
| Barrier 与 Transition 规划 | 知道每次 SRV/UAV/RTV/Copy 访问 | 保证可见性，并减少不必要的状态切换 |
| Split Barrier 与跨队列 Fence | 知道生产者、消费者及队列边界 | 隐藏部分等待并支持异步计算 |
| 并行命令录制 | Pass Lambda 与依赖关系清晰 | 降低渲染线程瓶颈 |
| 兼容 Raster Pass 合并 | 知道附件、Load/Store 与访问是否兼容 | 减少 Render Pass 切换成本 |
| RDG Validation / Insights | 声明与图结构可被系统检查和展示 | 更早发现漏报、生命周期和调度问题 |

这些优化并非无条件发生。错误或保守的声明会缩小优化空间；过早 External 化会延长生命周期；滥用 Immediate Command List、`NeverCull` 或 Async Compute flags 也可能抑制优化。

RDG 负责的是 **Pass 之间** 的资源管理与同步，它不会修复：

- Shader 越界、格式不匹配或未初始化读取；
- 同一个 Pass 内多个 GPU 线程写同一地址的数据竞争；
- 错误的 Dispatch/Draw 范围；
- 立即等待 GPU Readback 导致的 CPU/GPU 同步点；
- 算法本身产生的无效工作。

因此顺序应始终是：先正确表达数据流，再由工具验证实际收益。

---

## 9. 面对新需求时的设计顺序

不要从“该调用哪个 RDG API”开始。先按下面的顺序设计。

### 9.1 先画数据流

写清每个 Pass 的输入、输出与访问方式：

```text
Depth(SRV) + Parameters
        ↓
BuildMask(Compute)
        ↓ Mask(UAV → SRV)
Composite(Raster) + SceneColor(Load/RTV)
        ↓
FinalColor
```

### 9.2 再决定资源所有权

- 只在当前图使用：创建 Transient 资源；
- 图外已有输入或输出：Register；
- 图后或下一帧仍需使用：Extract，并由图外资源持有；
- GPU 结果交给 CPU：使用异步 Readback，在后续时刻确认就绪后读取。

### 9.3 再定义访问契约

确保每个 Pass 的 SRV、UAV、Render Target、Depth Stencil、Copy 和 Indirect Args 访问都完整出现在 Pass 参数或正规的 RDG 辅助 Pass 中。Shader permutation 使某些资源未使用时，应清理对应声明，避免虚假依赖。

### 9.4 最后写执行代码

Lambda 只记录当前 Pass 的 GPU 命令。若 Lambda 需要访问某个资源，但参数结构里找不到对应声明，应先修正契约。

### 9.5 正确后再优化并测量

依次检查：

- 是否存在不必要的 Clear、Copy、Readback 或外部化；
- 资源尺寸与格式是否超过实际需求；
- 中间资源生命周期是否可以缩短；
- Pass 是否形成了不必要的依赖；
- Async Compute 是否真的产生队列重叠。

最终应抓住这样的核心思路：

> **不再先问“我该手动切换到什么状态、何时释放资源、等待哪条队列”，而是先问“这个 Pass 准确地读什么、写什么，结果最终流向哪里”。声明正确后，RDG 才能在保证正确性的同时获得优化空间。**

如果只保留一个检查标准，就是：

> **看一眼传给 Pass 的参数，能否完整回答它会怎样访问每一个 GPU 资源？**
