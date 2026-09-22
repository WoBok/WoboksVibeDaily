---
title: "UE SceneViewExtension"
date: "2026-09-22"
summary: "梳理 UE Scene View Extension 的注册、生命周期与渲染钩子时序，并示例说明视图参数修改、跨线程传参、RDG 后处理 Pass 和自定义钩子的实现。"
category: "Unreal Engine"
tags:
  - "Unreal Engine"
  - "Scene View Extension"
  - "渲染管线"
  - "RDG"
  - "后处理"
---

## 0. 概述

**Scene View Extension 是引擎在渲染流程中预留的一组扩展接口（虚函数）。** 开发者继承基类、重写所需的虚函数，并将扩展注册到引擎。渲染流程执行到相应阶段时，引擎会按优先级依次调用所有已注册的扩展。

它的主要能力如下：

- **修改相机与画面参数**：包括视角、投影矩阵、后处理设置和 ShowFlags。
- **在渲染管线中插入自定义 Pass**：可插入的位置包括 GBuffer 之后、后处理之前、Tonemap 之后等。
- **无需修改引擎源码**：VR 头显、Composure 以及各类超分辨率插件均基于该机制实现。

## 1. 核心数据结构：FSceneViewFamily 与 FSceneView

绝大多数钩子函数都以这两个类型作为参数，因此需要先明确它们的含义与组成。

### 1.1 关系

```
FSceneViewFamily            一次渲染提交：将场景绘制到某个 RenderTarget 上
 ├─ RenderTarget / Scene / ShowFlags / Time …    Family 内所有 View 共享
 ├─ ViewExtensions[]                              本次生效的扩展（已按优先级排序）
 └─ Views[]
     ├─ FSceneView  (视点 1：主相机 / 左眼 / 分屏 P1)
     └─ FSceneView  (视点 2：右眼 / 分屏 P2)
```

**Family 表示一次完整的渲染输出，View 表示该输出中的一个观察视点。** 各视点共享同一个渲染目标，各自占据其中的一块区域。

- 单人游戏：1 个 Family，包含 1 个 View。
- VR 或本地分屏：1 个 Family，包含 2 个 View。
- 一帧中通常存在**多个 Family**：主视口、每个 SceneCapture、每个编辑器视口以及缩略图渲染，都会各自创建 Family。

### 1.2 FSceneViewFamily：各视点共享的数据

| 成员 | 含义 |
|---|---|
| `RenderTarget` | 渲染输出的目标 |
| `Scene` | 要渲染的场景（`FSceneInterface`，即 UWorld 在渲染侧的对应对象） |
| `Views` | 包含的全部视点 |
| `EngineShowFlags` | 渲染功能开关，例如 Bloom、Fog、Wireframe |
| `ViewMode` | 视图模式：Lit、Unlit、Wireframe 等 |
| `Time` | 时间信息（`FGameTime`，包含 RealTime 与 WorldTime） |
| `FrameNumber` | 帧号。GameThread 构建阶段为 `UINT_MAX`，开始渲染时才被赋值 |
| `ViewExtensions` | 本次生效的扩展列表 |
| `SceneCaptureSource` | SceneCapture 的输出内容类型（颜色、深度等） |
| `bRealtimeUpdate`、`bIsHDR`、`GammaCorrection` … | 其他全局渲染参数 |

### 1.3 FSceneView：单个视点独有的数据

| 成员 | 含义 |
|---|---|
| `Family` | 指向所属的 Family |
| `ViewMatrices` | View、Projection、ViewProjection 及其逆矩阵，以及 `PreViewTranslation` 等 |
| `ViewLocation` / `ViewRotation` / `FOV` | 相机位置、旋转与视场角 |
| `UnscaledViewRect` | 在 RenderTarget 上占据的矩形（输出分辨率） |
| `UnconstrainedViewRect` | 不考虑宽高比约束（黑边）的矩形 |
| `FinalPostProcessSettings` | 所有 PostProcessVolume 混合完成后的**最终**后处理参数 |
| `State` | `FSceneViewStateInterface*`，**跨帧持久**的数据，例如 TAA 历史、自动曝光、遮挡查询 |
| `ViewUniformBuffer` | 传递给 Shader 的 View 常量（即 Shader 中的 `View.xxx`） |
| `AntiAliasingMethod` | 抗锯齿方式 |
| `StereoViewIndex` | VR 双眼索引 |
| `bIsGameView` / `bIsSceneCapture` / `bIsReflectionCapture` / `bIsPlanarReflection` | 视点类型标记，**是过滤时最常用的判断依据** |

### 1.4 渲染器内部类型与数据生命周期

**（1）渲染线程中的实际类型**

GameThread 构建的是公开类型。进入渲染器后，引擎会基于它们创建渲染器内部的派生类型：

| 公开类型（插件可用） | 渲染器内部类型 | 创建方式 | 额外包含的数据 |
|---|---|---|---|
| `FSceneViewFamily` | `FViewFamilyInfo` | 创建渲染器时拷贝 GameThread 的 Family | 渲染器所需的场景纹理配置等 |
| `FSceneView` | `FViewInfo` | 基于 GameThread 的 View 重新构建 | 可见性结果、网格绘制命令、`ViewRect`（内部渲染分辨率下的矩形）等 |

由此可以得出两点：

- RenderThread 钩子接收的 `FSceneView&`，实际指向的是一个 `FViewInfo` 对象。
- `FViewInfo` 定义在 `Renderer/Private/SceneRendering.h` 中，插件无法包含该头文件，因此只能访问基类 `FSceneView` 公开的成员。例如 `ViewRect` 只存在于 `FViewInfo` 上，插件应改用 `UnscaledViewRect`，或使用后处理回调输入中提供的 `ViewRect`。

**（2）数据的生命周期**

| 数据 | 生命周期 |
|---|---|
| Family 与 View | 每帧重新构建，渲染完成后销毁 |
| `View.State` | 跨帧持久，与视口或 SceneCapture 组件绑定 |

因此，需要跨帧保存的数据（例如时域算法的历史帧），应以 `View.State` 为键存储在扩展自身的容器中，而不能保存 View 的指针。

## 2. 引擎机制：注册 → 收集 → 调用

### 2.1 注册：加入全局列表

所有扩展都必须继承 `FSceneViewExtensionBase`。其构造函数要求传入一个 `FAutoRegister` 参数，而该类型的构造函数是私有的，只有友元类 `FSceneViewExtensions` 能够创建它。由此**强制所有扩展都必须通过工厂函数创建**。

```cpp
// Engine/Public/SceneViewExtension.h
class FAutoRegister
{
    friend class FSceneViewExtensions;
    FAutoRegister(){}                         // 私有构造函数，外部无法创建
};

class FSceneViewExtensionBase : public ISceneViewExtension,
                                public TSharedFromThis<FSceneViewExtensionBase, ESPMode::ThreadSafe>
{
public:
    FSceneViewExtensionBase(const FAutoRegister&) {}
    // 可动态挂接额外的激活判断函数
    TArray<FSceneViewExtensionIsActiveFunctor> IsActiveThisFrameFunctions;
    ENGINE_API virtual bool IsActiveThisFrame(const FSceneViewExtensionContext& Context) const override final;
};

class FSceneViewExtensions
{
public:
    template<typename ExtensionType, typename... TArgs>
    static TSharedRef<ExtensionType, ESPMode::ThreadSafe> NewExtension(TArgs&&... Args)
    {
        TSharedRef<ExtensionType, ESPMode::ThreadSafe> NewExtension =
            MakeShareable(new ExtensionType(FAutoRegister(), Forward<TArgs>(Args)...));
        RegisterExtension(NewExtension);      // 注册
        return NewExtension;                  // 将强引用返回给调用者
    }
private:
    TArray<TWeakPtr<ISceneViewExtension, ESPMode::ThreadSafe>> KnownExtensions;   // 注意：弱引用
};
```

`RegisterExtension` 完成两项工作：先清理已失效的弱引用，再加入新的扩展。

```cpp
// Engine/Private/SceneViewExtension.cpp
void FSceneViewExtensions::RegisterExtension(const FSceneViewExtensionRef& RegisterMe)
{
    if (ensure(GEngine))                                  // 依赖 GEngine，必须在引擎初始化之后调用
    {
        auto& KnownExtensions = GEngine->ViewExtensions->KnownExtensions;
        for (int32 i = 0; i < KnownExtensions.Num(); )    // 清理已失效的弱引用
        {
            if (KnownExtensions[i].IsValid()) { i++; }
            else { KnownExtensions.RemoveAtSwap(i); }
        }
        KnownExtensions.AddUnique(RegisterMe);
    }
}
```

**关键结论：引擎只持有弱引用。** 因此：

- 扩展的生命周期由**调用者持有的强引用**决定。
- 释放强引用即自动注销，**引擎不提供 Unregister 函数**。
- 如果不保存 `NewExtension` 的返回值，扩展会立即被销毁。

### 2.2 收集：为每个 Family 单独筛选并排序

每构建一个 Family，引擎都会调用 `GatherActiveExtensions`：

```cpp
// Engine/Private/SceneViewExtension.cpp
const TArray<FSceneViewExtensionRef> FSceneViewExtensions::GatherActiveExtensions(
    const FSceneViewExtensionContext& InContext) const
{
    TArray<FSceneViewExtensionRef> ActiveExtensions;
    ForEachActiveViewExtension(KnownExtensions, InContext,
        [&ActiveExtensions](const FSceneViewExtensionRef& ActiveExtension)
        {
            ActiveExtensions.Add(ActiveExtension);
        });

    // 按优先级从高到低排序
    Algo::SortBy(ActiveExtensions, &ISceneViewExtension::GetPriority, TGreater<>());
    return ActiveExtensions;
}

void FSceneViewExtensions::ForEachActiveViewExtension(...)
{
    for (const TWeakPtr<ISceneViewExtension, ESPMode::ThreadSafe>& ViewExtPtr : InExtensions)
    {
        TSharedPtr<ISceneViewExtension, ESPMode::ThreadSafe> ViewExt = ViewExtPtr.Pin();   // 弱引用提升为强引用
        if (ViewExt.IsValid() && ViewExt->IsActiveThisFrame(InContext))                    // 判断该扩展是否参与此 Family
        {
            Func(ViewExt.ToSharedRef());
        }
    }
}
```

以游戏视口为例，收集结果直接存入 Family：

```cpp
// Engine/Private/GameViewportClient.cpp  UGameViewportClient::Draw()
FSceneViewFamilyContext ViewFamily(FSceneViewFamily::ConstructionValues(
    InViewport, MyWorld->Scene, EngineShowFlags).SetRealtimeUpdate(true));

FSceneViewExtensionContext ViewExtensionContext(InViewport);
ViewExtensionContext.bStereoEnabled = true;
ViewFamily.ViewExtensions = GEngine->ViewExtensions->GatherActiveExtensions(ViewExtensionContext);  // ← 收集

for (auto ViewExt : ViewFamily.ViewExtensions)
{
    ViewExt->SetupViewFamily(ViewFamily);          // ← 第一个钩子
}
```

**关键结论：**

- `IsActiveThisFrame` 以 **Family 为单位**进行判断。返回 `false` 时，该 Family 的所有钩子都不会调用此扩展。
- `ViewFamily.ViewExtensions` 是一份**快照**。此后该 Family 的所有钩子都按照这份列表及其顺序调用。
- 列表中保存的是强引用（`TSharedRef`），因此即使模块在渲染过程中释放了扩展，当前帧也不会出现悬空指针。

### 2.3 调用：引擎在各阶段预置的循环

所谓"钩子"，就是引擎源码在固定位置预置的遍历调用。以下是几个典型的调用点。

**GameThread：创建 View 之后**

```cpp
// Engine/Private/LocalPlayer.cpp  ULocalPlayer::CalcSceneView()
FSceneView* const View = new FSceneView(ViewInitOptions);
ViewFamily->Views.Add(View);
...
View->StartFinalPostprocessSettings(ViewInfo.Location);
View->OverridePostProcessSettings(...);            // 混合各 PostProcessVolume
View->EndFinalPostprocessSettings(ViewInitOptions);

for (int ViewExt = 0; ViewExt < ViewFamily->ViewExtensions.Num(); ViewExt++)
{
    ViewFamily->ViewExtensions[ViewExt]->SetupView(*ViewFamily, *View);   // 此时后处理参数已是最终值
}
```

**GameThread：创建渲染器前后**

```cpp
// Renderer/Private/SceneRenderBuilder.cpp
for (FSceneViewFamily* ViewFamily : ViewFamilies)
{
    for (auto& ViewExtension : ViewFamily->ViewExtensions)
    {
        ViewExtension->BeginRenderViewFamily(*ViewFamily);      // 渲染器拷贝 Family 之前
    }

    if (ShadingPath == EShadingPath::Deferred)
    {
        OutRenderers.Add(new FDeferredShadingSceneRenderer(ViewFamily, HitProxyConsumer));   // 拷贝 Family，创建渲染器
    }
    else
    {
        OutRenderers.Add(new FMobileSceneRenderer(ViewFamily, HitProxyConsumer));
    }

    for (auto& ViewExtension : ViewFamily->ViewExtensions)
    {
        ViewExtension->PostCreateSceneRenderer(*ViewFamily, OutRenderers.Last());   // 渲染器创建之后
    }
}
// 随后渲染器被投递到 RenderThread 执行
```

**RenderThread：渲染开始时**

```cpp
// Renderer/Private/SceneRendering.cpp
for (auto& ViewExtension : ViewFamily.ViewExtensions)
{
    ViewExtension->PreRenderViewFamily_RenderThread(GraphBuilder, ViewFamily);

    for (FViewInfo* View : AllViews)
    {
        ViewExtension->PreRenderView_RenderThread(GraphBuilder, *View);
    }
}
```

注意此处的循环顺序：**外层遍历扩展，内层遍历 View**。实际执行顺序为：

```
A.PreRenderViewFamily → A.PreRenderView(每个 View) → B.PreRenderViewFamily → B.PreRenderView(每个 View)
```

**RenderThread：后处理之前（延迟渲染）**

```cpp
// Renderer/Private/DeferredShadingRenderer.cpp  FDeferredShadingSceneRenderer::Render()
for (int32 ViewExt = 0; ViewExt < ViewFamily.ViewExtensions.Num(); ++ViewExt)
{
    for (int32 ViewIndex = 0; ViewIndex < ViewFamily.Views.Num(); ++ViewIndex)
    {
        FViewInfo& View = Views[ViewIndex];
        ViewFamily.ViewExtensions[ViewExt]->PrePostProcessPass_RenderThread(GraphBuilder, View, PostProcessingInputs);
    }
}
```

**RenderThread：构建后处理链时订阅回调**

```cpp
// Renderer/Private/PostProcess/PostProcessing.cpp  AddPostProcessingPasses()
constexpr int32 FirstAfterPass = static_cast<int32>(ISceneViewExtension::EPostProcessingPass::MotionBlur);

// MotionBlur 之前的阶段（BeforeDOF、AfterDOF 等）由引擎在对应位置直接调用
TStaticArray<FPostProcessingPassDelegateArray, FirstAfterPass> SceneViewExtensionDelegates;

for (const TSharedRef<ISceneViewExtension>& ViewExtension : View.Family->ViewExtensions)
{
    for (int32 SceneViewPassId = 0; SceneViewPassId < FirstAfterPass; SceneViewPassId++)
    {
        ...
        ViewExtension->SubscribeToPostProcessingPass(SceneViewPass, View, SceneViewExtensionDelegates[SceneViewPassId], bIsEnabled);
    }

    // MotionBlur 及之后的阶段挂接到后处理 Pass 序列上
    for (int32 SceneViewPassId = FirstAfterPass; SceneViewPassId < (int32)ISceneViewExtension::EPostProcessingPass::MAX; SceneViewPassId++)
    {
        const ISceneViewExtension::EPostProcessingPass SceneViewPass = static_cast<ISceneViewExtension::EPostProcessingPass>(SceneViewPassId);
        const EPass PostProcessingPass = TranslatePass(SceneViewPass);

        // 询问每个扩展是否需要在该阶段之后插入处理；需要时向数组中添加委托
        ViewExtension->SubscribeToPostProcessingPass(
            SceneViewPass,
            View,
            PassSequence.GetAfterPassCallbacks(PostProcessingPass),
            PassSequence.IsEnabled(PostProcessingPass));
    }
}
```

### 2.4 一帧的完整时序

```
【GameThread】UGameViewportClient::Draw()
  GatherActiveExtensions            ← 调用 IsActiveThisFrame，按 GetPriority 排序
  SetupViewFamily                   ← 此时 Family.Views 仍为空
  ┌ 每个 LocalPlayer：
  │   SetupViewPoint                ← 仅包含位置、旋转、FOV
  │   SetupViewProjectionMatrix     ← 投影矩阵
  │   new FSceneView → SetupView    ← View 已创建，后处理参数已是最终值
  └
  BeginRenderViewFamily             ← 渲染器拷贝 Family 之前的最后一个钩子
  创建 SceneRenderer（拷贝 Family）
  PostCreateSceneRenderer           ← 渲染器已创建
  投递到 RenderThread
══════════════════════════ 线程交接 ══════════════════════════
【RenderThread】FSceneRenderer::Render()
  PreRenderViewFamily / PreRenderView
  PreInitViews                      ← 可见性剔除之前
  PreRenderBasePass
  PostRenderBasePassDeferred / PostRenderBasePassMobile
  PrePostProcessPass / PrePostProcessPassMobile   ← 线性 HDR SceneColor
  SubscribeToPostProcessingPass     ← 在后处理的各阶段插入回调
  PostRenderViewFamily / PostRenderView
```

## 3. 多个扩展之间的数据共享

**所有扩展接收的是同一个对象的引用，并按优先级依次执行。先执行的扩展所做的修改对后续扩展可见，同一字段以最后执行的扩展写入的值为准。**

以 `SetupView` 为例，循环中每次传入的都是同一个 `*View`：

```cpp
for (int ViewExt = 0; ViewExt < ViewFamily->ViewExtensions.Num(); ViewExt++)
{
    ViewFamily->ViewExtensions[ViewExt]->SetupView(*ViewFamily, *View);   // 同一个 View，按引用传递
}
```

假设扩展 A 的优先级为 100，扩展 B 的优先级为 0：

```
A.SetupView:  ColorSaturation 1 → 0      （画面变为灰度）
B.SetupView:  读取到 ColorSaturation = 0 （可见 A 的修改）
              若 B 将其改回 1，最终结果以 B 为准
```

相关规则如下：

| 规则 | 说明 |
|---|---|
| 执行顺序 | 由 `GetPriority()` 决定，值越大越先执行，与注册顺序无关 |
| 冲突处理 | 引擎不做冲突检测，最后写入的值生效。多个插件修改同一字段时，需要通过约定或优先级进行协调 |
| GameThread 与 RenderThread 的对象不同 | 渲染器创建时会**拷贝**一份 Family，View 也会重建为 `FViewInfo`。GameThread 上的修改会随拷贝进入渲染流程；RenderThread 钩子修改的是渲染器持有的副本 |
| 修改 Family 的最后时机 | `BeginRenderViewFamily`，位于渲染器拷贝 Family 之前 |
| 修改 View 参数的时机 | `SetupView`，此时 `FinalPostProcessSettings` 已混合完毕，修改的即为最终值 |

## 4. 如何实现一个 View Extension

### 4.1 模块依赖

```csharp
// MyPlugin.Build.cs
PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine" });
PrivateDependencyModuleNames.AddRange(new[] { "RenderCore", "Renderer", "RHI", "Projects" });
```

在 `.uplugin` 中将模块的 `LoadingPhase` 设为 `PostConfigInit`，以确保在全局 Shader 编译之前完成 Shader 目录的注册。

### 4.2 声明扩展类

所有钩子都提供了空的默认实现，只需重写实际用到的函数。

```cpp
// MyViewExtension.h
#pragma once
#include "SceneViewExtension.h"

class FMyViewExtension : public FSceneViewExtensionBase
{
public:
    // 第一个参数必须是 FAutoRegister，并传递给基类
    FMyViewExtension(const FAutoRegister& AutoRegister) : FSceneViewExtensionBase(AutoRegister) {}

    virtual int32 GetPriority() const override { return 0; }

    // ---- GameThread ----
    virtual void SetupView(FSceneViewFamily& InViewFamily, FSceneView& InView) override;
    virtual void BeginRenderViewFamily(FSceneViewFamily& InViewFamily) override;

    // ---- RenderThread ----
    virtual void SubscribeToPostProcessingPass(EPostProcessingPass Pass, const FSceneView& InView,
        FAfterPassCallbackDelegateArray& InOutPassCallbacks, bool bIsPassEnabled) override;

protected:
    virtual bool IsActiveThisFrame_Internal(const FSceneViewExtensionContext& Context) const override;

private:
    FScreenPassTexture MyPass_RenderThread(FRDGBuilder& GraphBuilder, const FSceneView& View,
                                           const FPostProcessMaterialInputs& Inputs);

    float Intensity_RT = 0.f;     // 仅在 RenderThread 读写
};
```

### 4.3 创建与生命周期

```cpp
// MyModule.cpp
class FMyModule : public IModuleInterface
{
    TSharedPtr<FMyViewExtension, ESPMode::ThreadSafe> Extension;   // 持有强引用，扩展即保持存活

    virtual void StartupModule() override
    {
        // 1. 注册 Shader 虚拟路径（PostConfigInit 阶段）
        FString Dir = FPaths::Combine(IPluginManager::Get().FindPlugin(TEXT("MyPlugin"))->GetBaseDir(), TEXT("Shaders"));
        AddShaderSourceDirectoryMapping(TEXT("/Plugin/MyPlugin"), Dir);

        // 2. PostConfigInit 阶段 GEngine 尚未创建，需在引擎初始化完成后再创建扩展
        FCoreDelegates::OnPostEngineInit.AddLambda([this]()
        {
            Extension = FSceneViewExtensions::NewExtension<FMyViewExtension>();
        });
    }

    virtual void ShutdownModule() override
    {
        Extension.Reset();          // 释放强引用即注销
    }
};
```

扩展的持有者可按需求选择：

- **全局生效**：由模块持有。
- **跟随特定世界**：由 `UWorldSubsystem` 持有，并继承引擎提供的 `FWorldSceneViewExtension`，它会自动只在该世界的 Family 中生效。

### 4.4 过滤：限定生效的 Family

若不做过滤，编辑器视口、材质预览、缩略图、SceneCapture 都会调用该扩展。

```cpp
bool FMyViewExtension::IsActiveThisFrame_Internal(const FSceneViewExtensionContext& Context) const
{
    const UWorld* World = Context.GetWorld();    // 通过 Viewport 或 Scene 获取所属世界
    return World && World->IsGameWorld();        // 仅在 PIE 与独立游戏中生效
}
```

- **Family 级过滤**：在 `IsActiveThisFrame_Internal` 中完成，返回 `false` 时整个 Family 都不会调用该扩展。
- **View 级过滤**：在具体钩子中判断 `View.bIsSceneCapture`、`View.bIsGameView` 等标记。

### 4.5 在 GameThread 修改数据

```cpp
void FMyViewExtension::SetupView(FSceneViewFamily& InViewFamily, FSceneView& InView)
{
    // View 级：仅影响当前视点
    InView.FinalPostProcessSettings.ColorSaturation = FVector4(0, 0, 0, 1);

    // Family 级：影响 Family 中的所有 View
    InViewFamily.EngineShowFlags.SetBloom(false);
}
```

### 4.6 GameThread → RenderThread 传递参数

RenderThread 上**不应**读取 UObject，也不应读取 CVar 的 GameThread 值。标准做法是在 GameThread 的最后一个钩子中计算好参数，并按值拷贝到渲染命令中。

```cpp
void FMyViewExtension::BeginRenderViewFamily(FSceneViewFamily& InViewFamily)
{
    const float Value = ComputeIntensityOnGameThread();

    // 捕获共享引用而非裸 this 指针，确保渲染命令执行时对象仍然存活
    TSharedRef<FMyViewExtension, ESPMode::ThreadSafe> Self = StaticCastSharedRef<FMyViewExtension>(AsShared());
    ENQUEUE_RENDER_COMMAND(MyExt_UpdateParams)([Self, Value](FRHICommandListImmediate&)
    {
        Self->Intensity_RT = Value;
    });
}
```

### 4.7 在后处理中插入 RDG Pass

**第一步：定义 Shader。**

```cpp
class FMyPS : public FGlobalShader
{
public:
    DECLARE_GLOBAL_SHADER(FMyPS);
    SHADER_USE_PARAMETER_STRUCT(FMyPS, FGlobalShader);

    BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
        SHADER_PARAMETER_RDG_TEXTURE(Texture2D<float4>, SceneColorTexture)
        SHADER_PARAMETER(FVector4f, InputViewRect)
        SHADER_PARAMETER(FVector4f, OutputViewRect)
        SHADER_PARAMETER(float, Intensity)
        RENDER_TARGET_BINDING_SLOTS()
    END_SHADER_PARAMETER_STRUCT()
};
IMPLEMENT_GLOBAL_SHADER(FMyPS, "/Plugin/MyPlugin/Private/MyEffect.usf", "MainPS", SF_Pixel);
```

**第二步：订阅后处理阶段。**

```cpp
void FMyViewExtension::SubscribeToPostProcessingPass(EPostProcessingPass Pass, const FSceneView& InView,
    FAfterPassCallbackDelegateArray& InOutPassCallbacks, bool bIsPassEnabled)
{
    // 引擎会针对每个 View 的每个 EPostProcessingPass 各调用一次，仅在需要的阶段添加回调
    if (Pass == EPostProcessingPass::Tonemap && bIsPassEnabled && Intensity_RT > 0.f)
    {
        InOutPassCallbacks.Add(FAfterPassCallbackDelegate::CreateRaw(this, &FMyViewExtension::MyPass_RenderThread));
    }
}
```

**第三步：在回调中添加 Pass。**

```cpp
FScreenPassTexture FMyViewExtension::MyPass_RenderThread(FRDGBuilder& GraphBuilder,
    const FSceneView& View, const FPostProcessMaterialInputs& Inputs)
{
    if (View.bIsSceneCapture)                                  // 不处理时必须原样返回，否则后处理链会中断
    {
        return Inputs.ReturnUntouchedSceneColorForPostProcessing(GraphBuilder);
    }

    const FScreenPassTexture SceneColor = FScreenPassTexture::CopyFromSlice(
        GraphBuilder, Inputs.GetInput(EPostProcessMaterialInput::SceneColor));

    // 若当前是后处理链的最后一个 Pass，引擎会提供 OverrideOutput（通常为 BackBuffer），必须写入该目标；
    // 否则新建一张纹理——RDG 中同一张纹理不能在同一个 Pass 中既读又写
    FScreenPassRenderTarget Output = Inputs.OverrideOutput;
    if (!Output.IsValid())
    {
        Output = FScreenPassRenderTarget::CreateFromInput(GraphBuilder, SceneColor,
                                                          ERenderTargetLoadAction::ENoAction, TEXT("MyEffect"));
    }

    auto* Params = GraphBuilder.AllocParameters<FMyPS::FParameters>();
    Params->SceneColorTexture = SceneColor.Texture;
    Params->InputViewRect  = FVector4f(SceneColor.ViewRect.Min.X, SceneColor.ViewRect.Min.Y,
                                       SceneColor.ViewRect.Width(), SceneColor.ViewRect.Height());
    Params->OutputViewRect = FVector4f(Output.ViewRect.Min.X, Output.ViewRect.Min.Y,
                                       Output.ViewRect.Width(), Output.ViewRect.Height());
    Params->Intensity = Intensity_RT;
    Params->RenderTargets[0] = Output.GetRenderTargetBinding();

    FGlobalShaderMap* ShaderMap = GetGlobalShaderMap(View.GetFeatureLevel());
    FPixelShaderUtils::AddFullscreenPass(GraphBuilder, ShaderMap, RDG_EVENT_NAME("MyEffect"),
        TShaderMapRef<FMyPS>(ShaderMap), Params, Output.ViewRect);

    return MoveTemp(Output);                                  // 返回值作为下一阶段的输入
}
```

---

## 5. 引擎内置钩子一览

| 钩子 | 线程 | 调用时机 | 典型用途 |
|---|---|---|---|
| `IsActiveThisFrame_Internal` | GT | 收集扩展时，每个 Family 一次 | 决定该扩展是否在此 Family 中生效 |
| `GetPriority` | GT | 收集扩展时 | 决定执行顺序，值越大越先执行 |
| `SetupViewFamily` | GT | Family 创建后、View 创建前 | 修改 ShowFlags 等 Family 级设置 |
| `SetupViewPoint` | GT | 计算相机视点时 | 修改相机位置与旋转（如 VR 头显追踪） |
| `SetupViewProjectionMatrix` | GT | 计算投影矩阵时 | 自定义投影（如离轴投影、CAVE 屏幕） |
| `SetupView` | GT | 每个 View 创建完成后 | 修改 `FinalPostProcessSettings`、矩阵等 View 参数 |
| `BeginRenderViewFamily` | GT | 渲染器拷贝 Family 之前 | 汇总参数并投递到 RenderThread |
| `PostCreateSceneRenderer` | GT | 渲染器创建之后 | 访问已创建的渲染器对象 |
| `PreRenderViewFamily_RenderThread` | RT | 渲染开始时 | 准备当前帧的 GPU 资源 |
| `PreRenderView_RenderThread` | RT | 渲染开始时，每个 View 一次 | 按 View 准备数据 |
| `PreInitViews_RenderThread` | RT | 可见性剔除之前 | 在剔除之前调整相关状态 |
| `PreRenderBasePass_RenderThread` | RT | BasePass 之前 | 在深度预通道之后插入 Pass |
| `PostRenderBasePassDeferred_RenderThread` | RT | 延迟渲染 BasePass 之后 | 追加写入 GBuffer、实现贴花类效果 |
| `PostRenderBasePassMobile_RenderThread` | RT | 移动端 BasePass 之后（位于 RenderPass 内部，只能获得 `RHICmdList`） | 移动端追加绘制 |
| `PostTLASBuild_RenderThread` | RT | 光线追踪 TLAS 构建之后（5.8 起） | 基于光追加速结构的自定义处理 |
| `PrePostProcessPass_RenderThread` | RT | 延迟渲染后处理链开始之前 | 在线性 HDR SceneColor 上处理 |
| `PrePostProcessPassMobile_RenderThread` | RT | 移动端后处理链开始之前 | 移动端的线性 HDR 处理 |
| `SubscribeToPostProcessingPass` | RT | 构建后处理链时，每个 View 的每个阶段各一次 | 在指定后处理阶段之后插入回调 |
| `PostRenderViewFamily_RenderThread` | RT | 场景渲染结束 | 调试绘制、收尾工作 |
| `PostRenderView_RenderThread` | RT | 场景渲染结束，每个 View 一次 | 按 View 收尾 |

`SubscribeToPostProcessingPass` 可订阅的阶段（按执行顺序）：

| 枚举值 | 位置 | 色彩空间 |
|---|---|---|
| `BeforeDOF` | 景深之前 | 线性 HDR |
| `AfterDOF` | 景深之后 | 线性 HDR |
| `TranslucencyAfterDOF` | 景深之后的半透明合成 | 线性 HDR |
| `SSRInput` | 生成 SSR 输入之后 | 线性 HDR |
| `ReplacingTonemapper` | 替换引擎的 Tonemapper | 输入 HDR，输出显示空间 |
| `MotionBlur` | 运动模糊之后 | 线性 HDR |
| `Tonemap` | 色调映射之后 | 显示空间 LDR |
| `FXAA` | FXAA 之后 | 显示空间 |
| `SMAA` | SMAA 之后（5.8 起） | 显示空间 |
| `VisualizeDepthOfField` | 景深可视化之后 | 调试用 |

> 枚举的数值会随版本变化，**不要把枚举值当作数字硬编码**。

---

## 6. 自定义钩子：必须修改引擎

### 6.1 为什么插件无法实现

钩子的本质是**引擎源码中预置的遍历调用**。插件无法在渲染器内部新增调用点，因此若要在引擎未预留的位置执行代码，只能修改引擎。

修改引擎之前，应先确认现有手段是否足以满足需求：

- 能否使用已有钩子，并配合 `SubscribeToPostProcessingPass` 实现？
- 能否使用后处理材质、自定义 `FPrimitiveSceneProxy` 或 SceneCapture 实现？

### 6.2 通用添加步骤

以"在半透明渲染之前"添加一个钩子为例，只需修改两处。

**第一步：在接口中声明虚函数，并提供空的默认实现。**

```cpp
// Engine/Source/Runtime/Engine/Public/SceneViewExtension.h
class ISceneViewExtension
{
public:
    ...
    /**
     * Called on render thread right before translucency rendering.
     */
    virtual void PreRenderTranslucency_RenderThread(FRDGBuilder& GraphBuilder, FSceneView& InView) {}
    ...
};
```

提供空实现，是为了**让所有已有扩展无需任何修改即可继续编译**。

**第二步：在渲染器的目标位置，按照引擎惯例遍历调用。**

```cpp
// Engine/Source/Runtime/Renderer/Private/DeferredShadingRenderer.cpp  FDeferredShadingSceneRenderer::Render()
...
for (FSceneViewExtensionRef& ViewExtension : ViewFamily.ViewExtensions)       // 已按优先级排序
{
    for (int32 ViewIndex = 0; ViewIndex < Views.Num(); ++ViewIndex)
    {
        FViewInfo& View = Views[ViewIndex];
        RDG_GPU_MASK_SCOPE(GraphBuilder, View.GPUMask);
        ViewExtension->PreRenderTranslucency_RenderThread(GraphBuilder, View);
    }
}

RenderTranslucency(GraphBuilder, ...);      // 原有代码
...
```

**第三步：重新编译引擎。** 之后插件即可重写该函数：

```cpp
virtual void PreRenderTranslucency_RenderThread(FRDGBuilder& GraphBuilder, FSceneView& InView) override;
```

### 6.3 添加钩子的注意事项

| 注意点 | 说明 |
|---|---|
| 参数使用 `FRDGBuilder` 还是 `FRHICommandList` | 调用点位于 RDG Pass **外部**时，传入 `GraphBuilder`，扩展可以自由 `AddPass`、创建纹理。调用点位于某个 `AddPass` 的 **lambda 内部**时，只能传入 `RHICmdList`，扩展只能向当前绑定的目标直接提交绘制命令，**不能新建 Pass，也不能切换 RenderTarget** |
| 覆盖所有渲染路径 | 延迟渲染与移动端、单 Pass 与多 Pass 通常是不同的代码分支，每条需要支持的路径都要添加调用 |
| 注意 Shipping 版本的差异 | 非 Shipping 版本会为每个 Family 额外追加一个渲染器内置扩展，Shipping 版本则不会。因此不要照搬 `if (ViewExtensions.Num() > 1)` 这类判断，否则在 Shipping 版本中只有一个用户扩展时会被跳过；应使用 `IsEmpty()` 判断或直接遍历 |
| 维护成本 | 修改 `SceneViewExtension.h` 会导致所有依赖 Engine 的模块重新编译，且每次升级引擎都需要重新合并。插件可在 `Build.cs` 中检测引擎头文件是否包含该函数，并通过宏决定是否编译对应的 `override`，以兼容原版引擎 |
