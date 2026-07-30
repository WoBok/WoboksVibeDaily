# 源码佐证 · UE 5.8

对《延迟渲染与前向渲染 · 原理图解》全部技术论断的逐条核验。

- **源码根目录**：`E:\UnrealEngine5.8`
- **核验日期**：2026-07-28
- 所有 `文件:行号` 均为核验时的实际位置。

**结论摘要**：18 条论断确认无误，**4 条必须修正**，2 条需要补充限定。修正项已全部回写进 HTML 文档。

---

## 目录

- [A. 确认无误的论断](#a-确认无误的论断)
- [B. 必须修正的论断](#b-必须修正的论断)
- [C. 需要补充限定的论断](#c-需要补充限定的论断)
- [D. 5.8 的新情况](#d-58-的新情况)

---

# A. 确认无误的论断

## A1 · G-Buffer 不存 Position，世界坐标从 Depth 反推

`Engine/Shaders/Private/DeferredShadingCommon.ush:379-439`

```hlsl
struct FGBufferData
{
	// normalized
	half3 WorldNormal;
	...
	// in unreal units (linear), can be used to reconstruct world position,
	// only valid when decoding the GBuffer as the value gets reconstructed from the Z buffer
	float Depth;
```

> **`FGBufferData` 中没有任何 Position / WorldPosition 字段**，注释明确写出「can be used to reconstruct world position … reconstructed from the Z buffer」。

**判定：✅ 确认。** 这是延迟渲染最重要的单项带宽优化（存 1 个 float 而非 3 个）。

---

## A2 · 法线用八面体压缩存进 G-Buffer

`DeferredShadingCommon.ush:612` （编码）与 `:724`（解码）

```hlsl
OutGBufferA.rg = UnitVectorToOctahedron(normalize(GBuffer.WorldNormal)) * 0.5 + 0.5;
...
GBuffer.WorldNormal = OctahedronToUnitVector(InGBufferA.rg * 2.0 - 1.0);
```

**判定：✅ 确认。** 三分量单位向量被压成两个通道 —— G-Buffer 布局压力的直接体现。

---

## A3 · ShadingModelID 只有 4 bit

`Engine/Shaders/Private/ShadingCommon.ush:20-35`

```hlsl
#define SHADINGMODELID_UNLIT				0
#define SHADINGMODELID_DEFAULT_LIT			1
#define SHADINGMODELID_SUBSURFACE			2
#define SHADINGMODELID_PREINTEGRATED_SKIN	3
#define SHADINGMODELID_CLEAR_COAT			4
#define SHADINGMODELID_SUBSURFACE_PROFILE	5
#define SHADINGMODELID_TWOSIDED_FOLIAGE		6
#define SHADINGMODELID_HAIR					7
#define SHADINGMODELID_CLOTH				8
#define SHADINGMODELID_EYE					9
#define SHADINGMODELID_SINGLELAYERWATER		10
#define SHADINGMODELID_THIN_TRANSLUCENT		11
#define SHADINGMODELID_SUBSTRATE			12		// Temporary while we convert everything to Substrate
#define SHADINGMODELID_SUBSTRATE_TOON		13
#define SHADINGMODELID_NUM					14
#define SHADINGMODELID_MASK					0xF		// 4 bits reserved for ShadingModelID
```

**判定：✅ 确认。** `0xF` = 4 bit，理论上限 16 种，已用掉 14 种。「想加一种新着色模型就得抢 bit」是字面意义上的事实。

写入位置 `DeferredShadingCommon.ush:1010`：
```hlsl
OutGBufferB.a = EncodeShadingModelIdAndSelectiveOutputMask(GBuffer.ShadingModelID, GBuffer.SelectiveOutputMask);
```
—— ShadingModelID 与 SelectiveOutputMask **共用 GBufferB 的 A 通道 8 bit**（各 4 bit）。

---

## A4 · CustomData 是被复用的通道，同一像素只能是一种 ShadingModel

桌面路径 `DeferredShadingCommon.ush:1023`：
```hlsl
OutGBufferD = GBuffer.CustomData;
```

移动路径 `DeferredShadingCommon.ush:640-705` 则按 ShadingModel 把 CustomData 拆散塞进各处空余通道：
```hlsl
// SUBSURFACE
OutGBufferB.a = GBuffer.CustomData.r; // SubsurfaceColor.R
OutGBufferC.a = GBuffer.CustomData.g; // SubsurfaceColor.G
OutGBufferB.r = GBuffer.CustomData.b; // SubsurfaceColor.B
// CLEAR_COAT
OutGBufferB.a = GBuffer.CustomData.x; // ClearCoat
OutGBufferC.a = GBuffer.CustomData.y; // ClearCoatRoughness
// EYE
OutGBufferC.a = GBuffer.CustomData.y; // IrisNormal_Oct.x
OutGBufferB.g = GBuffer.CustomData.z; // IrisNormal_Oct.y
```

**判定：✅ 确认，且比文档描述的更极端。** 这是一段 `switch(ShadingModelID)` 驱动的手工通道争抢代码 —— 「固定布局锁死材质表达」的最佳实证。同一像素只能走其中一个分支，所以只能是一种 ShadingModel。

---

## A5 · 光照 Pass 用加法混合累加

`Engine/Source/Runtime/Renderer/Private/LightRendering.cpp:2528`

```cpp
FRHIBlendState* BlendState = TStaticBlendState<CW_RGBA, BO_Add, BF_One, BF_One, BO_Add, BF_One, BF_One>::GetRHI();
```

**判定：✅ 确认。** `BO_Add, BF_One, BF_One` 即 `Dst = Src * 1 + Dst * 1`。光照的叠加性是「每盏灯可以是独立 draw」的数学前提。

---

## A6 · 光源被画成代理几何体，配合 Depth Bounds Test

`LightRendering.cpp:3067-3093`

```cpp
// Use DBT to allow work culling on shadow lights
if (GraphicsPSOInit.bDepthBounds)
{
	// Can use the depth bounds test to skip work for pixels which won't be touched by the light
	CalculateLightNearFarDepthFromBounds(View, LightBounds, NearDepth, FarDepth);
	...
	RHICmdList.SetDepthBounds(FarDepth, NearDepth);
}

if( LightType == LightType_Point || LightType == LightType_Rect )
{
	// Apply the point or spot light with some approximate bounding geometry,
	// So we can get speedups from depth testing and not processing pixels outside of the light's influence.
	StencilingGeometry::DrawSphere(RHICmdList);
}
else if (LightType == LightType_Spot)
{
	StencilingGeometry::DrawCone(RHICmdList);
}
```

球体网格定义在 `LightRendering.cpp:864`：
```cpp
TGlobalResource<StencilingGeometry::TStencilSphereVertexBuffer<18, 12, FVector4f> > StencilingGeometry::GStencilSphereVertexBuffer;
```
—— 18×12 段的低模球。

**判定：✅ 确认。** 点光/面光 → 球，聚光 → 锥，并叠加 Depth Bounds Test。

---

## A7 · 方向光走全屏，且前向下单独处理

`LightRendering.cpp:1487-1499`

```cpp
// NOTE: bClusteredDeferredSupported==false means "lights cannot be batched" (tiled or clustered).
// When false, light will go the slower unbatched render path.
// Tiled and clustered deferred lighting only support certain lights that don't use any additional
// features (like shadow or light function not compatible with the atlas.)
// And also that are not directional (mostly because it doesn't make so much sense to insert them
// into every grid cell in the universe).
// In the forward case one directional light gets put into its own variables, and in the deferred
// case it gets a full-screen pass.
const bool bClusteredDeferredSupported =
	(!SortedLightInfo->SortKey.Fields.bShadowed || bShadowedLightsInClustered) &&
	(!SortedLightInfo->SortKey.Fields.bLightFunction || (bUseLightFunctionAtlas && ...))
	&& LightSceneInfoCompact.LightType != LightType_Directional
	&& LightSceneInfo->Proxy->GetContactShadowLength() == 0
	&& !bCastsFirstPersonSelfShadow
	&& !bHandledByMegaLights;
```

**判定：✅ 确认。** 这段代码同时证实了文档的三个说法：

1. 方向光在延迟下是全屏 Pass，在前向下占用一组专属 uniform；
2. **有阴影 / 有 Light Function / 有 Contact Shadow 的光源无法批处理**，只能走逐光源的 unbatched 路径；
3. 「批处理 vs 逐光源」这条分界线是真实存在的代码分支，不是概念简化。

对应的单一方向光 uniform 结构见 `LightGridInjection.cpp:337`：
```cpp
IMPLEMENT_GLOBAL_SHADER_PARAMETER_STRUCT(FForwardDirectionalLightShadowMapParameters, "ForwardDirLightShadowStruct");
```
—— 结构名是**单数**的 `DirectionalLight`，印证「前向下只有 1 盏方向光有完整 CSM」。

---

## A8 · Froxel 的 Z 方向是指数（对数）分布

`Engine/Source/Runtime/RenderCore/Public/RenderUtils.h:721-740`

```cpp
inline FVector CalculateGridZParams(float NearPlane, float FarPlane, float DepthDistributionScale, int32 GridSizeZ)
{
	// S = distribution scale
	// B, O are solved for given the z distances of the first+last slice, and the # of slices.
	//
	// slice = log2(z*B + O) * S

	// Don't spend lots of resolution right in front of the near plane
	double NearOffset = .095 * 100;
	// Space out the slices so they aren't all clustered at the near plane
	double S = DepthDistributionScale;

	double N = NearPlane + NearOffset;
	double F = FarPlane;

	double O = (F - N * FMath::Exp2(GridSizeZ / S)) / (F - N);
	double B = (1 - O) / N;

	return FVector(B, O, S);
}
```

调用处 `LightGridInjection.cpp:627-634`：
```cpp
FVector GetLightGridZParams(float NearPlane, float FarPlane)
{
	// Space out the slices so they aren't all clustered at the near plane
	float DepthDistributionScale = 4.05f;

	// reserve last slice to cover a larger range (see LightGridInjection.usf)
	return CalculateGridZParams(NearPlane, FarPlane, DepthDistributionScale, GLightGridSizeZ - 1);
}
```

**判定：✅ 确认。** `slice = log2(z*B + O) * S` 是对数映射，等价于世界空间里的指数分布切片（近密远疏）。

两个文档里没提到的细节：
- 有一个 `NearOffset = 9.5`（虚幻单位）用来避免把分辨率浪费在贴脸处；
- **最后一片被单独保留覆盖更大范围**，所以实际参与指数分布的是 `GLightGridSizeZ - 1` = 31 片而非 32 片。

---

## A9 · Light Grid 的三个默认值

`Engine/Source/Runtime/Renderer/Private/LightGridInjection.cpp:71-129`

```cpp
int32 GLightGridPixelSize = 64;
FAutoConsoleVariableRef CVarLightGridPixelSize(
	TEXT("r.Forward.LightGridPixelSize"),
	GLightGridPixelSize,
	TEXT("Size of a cell in the light grid, in pixels."), ...);

int32 GLightGridSizeZ = 32;
FAutoConsoleVariableRef CVarLightGridSizeZ(
	TEXT("r.Forward.LightGridSizeZ"),
	GLightGridSizeZ,
	TEXT("Number of Z slices in the light grid."), ...);

int32 GMaxCulledLightsPerCell = 32;
FAutoConsoleVariableRef CVarMaxCulledLightsPerCell(
	TEXT("r.Forward.MaxCulledLightsPerCell"), ...);
```

**判定：✅ 确认默认值 64 / 32 / 32。** 但 `MaxCulledLightsPerCell` 的**语义**在 5.8 已经变了 —— 见 [B2](#b2--每-cell-32-盏光源不再是硬上限)。

---

## A10 · 前向渲染强制全量 Depth Prepass

`Engine/Source/Runtime/RenderCore/Private/RenderUtils.cpp:681-702`

```cpp
RENDERCORE_API bool ShouldForceFullDepthPass(const FStaticShaderPlatform Platform)
{
	if (IsMobilePlatform(Platform))
	{
		return MobileUsesFullDepthPrepass(Platform);
	}
	else
	{
		const bool bNaniteEnabled = UseNanite(Platform);
		const bool bDBufferAllowed = IsUsingDBuffers(Platform);
		const bool bVirtualTextureEnabled = UseVirtualTexturing(Platform);
		const bool bStencilLODDither = IsStencilForLODDitherEnabled(Platform);
		...
		return bNaniteEnabled || bAOCompute || bDBufferAllowed || bVirtualTextureEnabled
			|| bStencilLODDither || bEarlyZMaterialMasking
			|| IsForwardShadingEnabled(Platform)          // ←←← 前向强制
			|| IsUsingSelectiveBasePassOutputs(Platform);
	}
}
```

**判定：✅ 确认前向强制全量 prepass。** 但这行代码同时**推翻了文档的另一半说法** —— 见 [C1](#c1--延迟只需一遍几何在-ue5-实践中基本不成立)。

---

## A11 · 全量 prepass 下 BasePass 转为深度只读（Depth-Equal）

`Engine/Source/Runtime/Renderer/Private/RendererScene.cpp:4408-4423`

```cpp
FExclusiveDepthStencil::Type FScene::GetDefaultBasePassDepthStencilAccess(ERHIFeatureLevel::Type InFeatureLevel)
{
	FExclusiveDepthStencil::Type BasePassDepthStencilAccess = FExclusiveDepthStencil::DepthWrite_StencilWrite;

	if (GetFeatureLevelShadingPath(InFeatureLevel) == EShadingPath::Deferred)
	{
		const EShaderPlatform ShaderPlatform = GetFeatureLevelShaderPlatform(InFeatureLevel);
		if (ShouldForceFullDepthPass(ShaderPlatform)
			&& CVarBasePassWriteDepthEvenWithFullPrepass.GetValueOnAnyThread() == 0)
		{
			BasePassDepthStencilAccess = FExclusiveDepthStencil::DepthRead_StencilWrite;
		}
	}
	return BasePassDepthStencilAccess;
}
```

**判定：✅ 确认。** `DepthWrite` → `DepthRead`：深度缓冲已被 prepass 填满，BasePass 只读不写，配合相等测试实现「每像素只着色一次」。这就是文档中「Depth Prepass 消除 overdraw」的具体实现机制。

---

## A12 · MSAA 只在桌面前向渲染器可用

`Engine/Source/Runtime/Engine/Private/SceneView.cpp:236-246`

```cpp
static TAutoConsoleVariable<int32> CVarDefaultAntiAliasing(
	TEXT("r.AntiAliasingMethod"),
	4,
	TEXT("Engine default (project setting) for AntiAliasingMethod is ...\n")
	TEXT(" 0: off (no anti-aliasing)\n")
	TEXT(" 1: Fast Approximate Anti-Aliasing (FXAA)\n")
	TEXT(" 2: Temporal Anti-Aliasing (TAA)\n")
	TEXT(" 3: Multisample Anti-Aliasing (MSAA, Only available on the desktop forward renderer)\n")
	TEXT(" 4: Temporal Super-Resolution (TSR, Default)\n")
	TEXT(" 5: Subpixel Morphological Anti-Aliasing (SMAA)"),
	ECVF_RenderThreadSafe);
```

**判定：✅ 确认「MSAA 仅前向」。** 引擎自己的 cvar 帮助文本就写着 "Only available on the desktop forward renderer"。

**但枚举值文档写错了** —— 见 [B3](#b3--msaa-的枚举值是-3-不是-2)。

---

## A13 · 半透明的 `Surface ForwardShading` 就是前向光照

`Engine/Source/Runtime/Engine/Classes/Engine/EngineTypes.h:347-354`

```cpp
	/** 
	 * Lighting will be calculated for a surface. ... 
	 * Only diffuse lighting is supported.
	 */
	TLM_Surface UMETA(DisplayName="Surface TranslucencyVolume"),

	/** 
	 * Lighting will be calculated for a surface. Use this on translucent surfaces like glass and water.
	 * This is implemented with forward shading so specular highlights from local lights are supported,
	 * however many deferred-only features are not.
	 * This is the most expensive translucency lighting method as each light's contribution is computed per-pixel.
	 */
	TLM_SurfacePerPixelLighting UMETA(DisplayName="Surface ForwardShading"),
```

**判定：✅ 确认。** 引擎注释直接说明 "This is implemented with forward shading"，并同时确认了「最贵」「逐像素」「许多 deferred-only 特性不可用」三点。

---

## A14 · 延迟渲染器每帧都在构建「前向」Light Grid ★

这是全文最核心的架构论断，也是证据最硬的一条。

`Engine/Source/Runtime/Renderer/Private/DeferredShadingRenderer.cpp:2799-2815`

```cpp
{
	RDG_CSV_STAT_EXCLUSIVE_SCOPE(GraphBuilder, PrepareForwardLightData);
	SCOPE_CYCLE_COUNTER(STAT_FDeferredShadingSceneRenderer_PrepareForwardLightData);

	const FSortedLightSetSceneInfo* SortedLightSet = GatherAndSortLightsTask.GetResult();

	if (!ViewFamily.EngineShowFlags.PathTracing)
	{
		ComputeLightGridOutput = PrepareForwardLightData(GraphBuilder, true, *SortedLightSet);

		// Store this flag if lights are injected in the grids, check with 'AreLightsInLightGrid()'
		bAreLightsInLightGrid = true;
	}
	else
	{
		SetDummyForwardLightUniformBufferOnViews(GraphBuilder, ShaderPlatform, Views);
	}
```

> 这是 **`FDeferredShadingSceneRenderer::Render()` 内部**的代码，`bCullLightsToGrid` 参数硬编码为 `true`，**与 `r.ForwardShading` 无关**。唯一的例外是路径追踪。

消费 `FForwardLightUniformParameters` 的文件（`Source/Runtime/Renderer/Private/` 下共 33 个）：

```
VolumetricFog.cpp                 VolumetricCloudRendering.cpp
TranslucentLighting.cpp           SingleLayerWaterRendering.cpp
VirtualShadowMapProjection.cpp    VirtualShadowMapArray.cpp
Lumen/LumenSceneDirectLighting.cpp  Lumen/LumenSceneRendering.cpp
Lumen/LumenHardwareRayTracingCommon.cpp
MegaLights/MegaLights.cpp         StochasticLighting/StochasticLighting.cpp
HairStrands/HairStrandsTransmittance.cpp
HeterogeneousVolumes/*.cpp        MobileBasePassRendering.cpp
ClusteredDeferredShadingPass.cpp  BasePassRendering.cpp   ...
```

**判定：✅ 确认，且证据强度超出文档原有表述。**

「clustered light culling 是与前向/延迟正交的独立基础设施」不只是一个说法 —— 在 5.8 里，**Lumen、VSM、体积雾、体积云、水体、头发、MegaLights 全都在消费这份所谓的「前向」光照网格**。把它归类为「前向渲染的特征」是明确错误的。

---

## A15 · 引擎里不存在独立的前向场景渲染器

`Engine/Source/Runtime/Renderer/Private/SceneRenderBuilder.cpp:514-522`

```cpp
if (ShadingPath == EShadingPath::Deferred)
{
	OutRenderers.Add(new FDeferredShadingSceneRenderer(ViewFamily, HitProxyConsumer));
}
else
{
	check(ShadingPath == EShadingPath::Mobile);
	OutRenderers.Add(new FMobileSceneRenderer(ViewFamily, HitProxyConsumer));
}
```

类定义只有两个：
- `Private/DeferredShadingRenderer.h:260` → `class FDeferredShadingSceneRenderer : public FSceneRenderer`
- `Private/SceneRendering.h:2957` → `class FMobileSceneRenderer : public FSceneRenderer`

对整个 `Source/Runtime/Renderer` 递归搜索 `FForwardShadingSceneRenderer`：**0 处命中。**

**判定：✅ 确认。** `EShadingPath` 只有 `Deferred` 和 `Mobile` 两个取值，前向着色是 `FDeferredShadingSceneRenderer` 内部由 `IsForwardShadingEnabled()` 控制的分支。文档的「不存在纯粹的延迟渲染器 / 前向只是延迟渲染器的一个分支」说法成立。

---

## A16 · 移动端用 Subpass 把 G-Buffer 留在片上

`Engine/Source/Runtime/Renderer/Private/MobileShadingRenderer.cpp:1053`
```cpp
BasePassRenderTargets.SubpassHint = ESubpassHint::DeferredShadingSubpass;
```

`Engine/Source/Runtime/Renderer/Private/MobileDeferredShadingPass.cpp:1436-1440`
```cpp
GraphicsPSOInit.SubpassHint = ESubpassHint::None;
...
	GraphicsPSOInit.SubpassHint = ESubpassHint::DeferredShadingSubpass;
```

配合 memoryless 资源标记 `MobileShadingRenderer.cpp:1541-1545`：
```cpp
Bindings.GBufferC.Flags &= ~TexCreate_Memoryless;
Bindings.GBufferA.Flags &= ~TexCreate_Memoryless;
```
（这两行是在需要多 Pass 时**取消** memoryless；默认路径下 G-Buffer 是带 `TexCreate_Memoryless` 的。）

**判定：✅ 确认。** `ESubpassHint::DeferredShadingSubpass` + `TexCreate_Memoryless` 正是「G-Buffer 写入后在 tile memory 内被直接读取、不回写系统内存」的实现手段。

---

## A17 · Nanite 的 Visibility Buffer

`Engine/Source/Runtime/Renderer/Private/Nanite/NaniteShading.cpp:1502-1546`

```cpp
	FRDGTextureRef VisBuffer64,
	...
	FRDGBufferRef VisibleClustersSWHW,
	...
		UniformParameters->VisibleClustersSWHW = GraphBuilder.CreateSRV(VisibleClustersSWHW);
		UniformParameters->VisBuffer64 = VisBuffer64;
```

`NaniteShading.cpp:1752`：
```cpp
// Add another MRT for Substrate top layer information. We want to follow the usual clear process which can leverage fast clear.
```

**判定：✅ 确认。** `VisBuffer64` 即 64-bit 的可见性缓冲；材质 Pass 从它反解并写入 G-Buffer/MRT。「Nanite 是在延迟之上再延迟一层（Deferred Materials）」成立。

---

## A18 · Substrate 在 5.8 仍默认关闭

`Engine/Source/Runtime/RenderCore/Private/RenderUtils.cpp:2068-2076`

```cpp
static TAutoConsoleVariable<int32> CVarSubstrate(
	TEXT("r.Substrate"),
	0,
	TEXT("Enable Substrate materials."),
	ECVF_ReadOnly | ECVF_RenderThreadSafe);

// Summary:
// * Existing project NOT using Substrate will continue to NOT use Substrate.
// * Existing project using Substrate will continue to use Substrate with Adaptive GBuffer
```

**判定：✅ 确认。** 默认 `0`，且是 `ECVF_ReadOnly`（需重启）。文档把 Substrate 描述为「方向 / 需谨慎评估」是准确的。

---

# B. 必须修正的论断

## B1 · Clustered Deferred Shading 在 5.8 已弃用且默认关闭 ★

**文档原文（错误）**：
> Clustered Deferred Shading（`r.UseClusteredDeferredShading`，**默认开**）……一遍打完几十上百盏灯。

**实际情况** —— `Engine/Source/Runtime/Renderer/Private/ClusteredDeferredShadingPass.cpp:36-45`

```cpp
static FAutoConsoleVariableDeprecated CVarUseClusteredDeferredShadingDep(
	TEXT("r.UseClusteredDeferredShading"), TEXT("r.UseClusteredDeferredShading_ToBeRemoved"), TEXT("5.7"));

// This is used to switch on and off the clustered deferred shading implementation, that uses the light grid to perform shading.
int32 GUseClusteredDeferredShading = 0;
static FAutoConsoleVariableRef CVarUseClusteredDeferredShading(
	TEXT("r.UseClusteredDeferredShading_ToBeRemoved"),
	GUseClusteredDeferredShading,
	TEXT("NOTE: The clustered deferred shading implementation will be removed in a future release due to low utility and thus use.\n")
	TEXT("Toggle use of clustered deferred shading for lights that support it. 0 is off (default), 1 is on (also required is SM5 to actually turn on)."),
	ECVF_RenderThreadSafe);
```

同文件 `:64` 的启用条件还要求 SM6 + VSM 支持：
```cpp
return CVarClusteredDeferredShadingEnableForProject.GetValueOnAnyThread() > 0
	&& GUseClusteredDeferredShading != 0
	&& Scene->GetFeatureLevel() >= ERHIFeatureLevel::SM6
	&& DoesPlatformSupportVirtualShadowMaps(InPlatform);
```

**三处错误：**

| 文档说法 | 5.8 实际 |
|---|---|
| cvar 名 `r.UseClusteredDeferredShading` | 5.7 起弃用，重命名为 `r.UseClusteredDeferredShading_ToBeRemoved` |
| 默认开（1） | 默认 **关（0）** |
| 是延迟渲染的主力多光源路径 | 引擎注释："will be removed in a future release **due to low utility and thus use**" |

**5.8 的替代方案是 MegaLights。** `LightRendering.cpp:1483`：
```cpp
const bool bHandledByMegaLights = MegaLights::GetMegaLightsMode(ViewFamily, LightSceneInfoCompact.LightType,
	LightSceneInfoCompact.bAllowMegaLights, LightSceneInfoCompact.MegaLightsShadowMethod) != EMegaLightsMode::Disabled;
```
MegaLights 在光源排序阶段被优先摘出，走独立的随机采样 + 降噪管线（`Private/MegaLights/`、`Private/StochasticLighting/`）。

**对文档的影响**：

「延迟渲染借用前向的 Light Grid」这个**架构论点依然成立**（`ClusteredDeferredShadingPass.cpp:211` 仍然绑定 `ForwardLightStruct`，且 A14 证明整个渲染器都在消费它），但**不能再用 Clustered Deferred 作为它的主要例证** —— 那条路径正在被删除。应改用 A14 的证据（Lumen / VSM / 体积雾 / 水体 / MegaLights 共同消费 Light Grid）。

同时，「延迟的多光源批处理」在 5.8 的正确表述是**三条路径**：
1. **MegaLights**（5.8 的新主力，随机采样）
2. **Standard Deferred**（unbatched，逐光源画代理体积）
3. ~~Clustered Deferred~~（默认关，待移除）

---

## B2 · 「每 cell 32 盏光源」不再是硬上限

**文档原文（不准确）**：
> 单 cell 光源上限由 `r.Forward.MaxCulledLightsPerCell`（默认 32）约束。
> 每像素受影响的光源数受 `MaxCulledLightsPerCell` 上限约束，超出部分直接丢弃。

**实际情况** —— `LightGridInjection.cpp:123-137`

```cpp
int32 GMaxCulledLightsPerCell = 32;
static FAutoConsoleVariableRef CVarMaxCulledLightsPerCell(
	TEXT("r.Forward.MaxCulledLightsPerCell"),
	GMaxCulledLightsPerCell,
	TEXT("Controls how much memory is allocated for each cell for light culling.  "
	     "When r.Forward.LightLinkedListCulling is enabled, this is used to compute a global max "
	     "instead of a per-cell limit on culled lights."),
	ECVF_Scalability | ECVF_RenderThreadSafe);

int32 GLightLinkedListCulling = 1;                      // ←←← 默认开
static FAutoConsoleVariableRef CVarLightLinkedListCulling(
	TEXT("r.Forward.LightLinkedListCulling"),
	GLightLinkedListCulling,
	TEXT("Uses a reverse linked list to store culled lights, removing the fixed limit on how many "
	     "lights can affect a cell - it becomes a global limit instead."),
	ECVF_Scalability | ECVF_RenderThreadSafe);
```

**修正**：`r.Forward.LightLinkedListCulling` **默认为 1**。开启后使用反向链表存储剔除结果，**per-cell 的固定上限被移除**，32 这个数字变成用于推算**全局**内存预算的系数，而不是「每格最多 32 盏」的裁剪阈值。

文档里 FIG 03 的「峰值 / 上限 32」读数因此具有误导性，已改为标注为「默认预算系数」并加注说明。

---

## B3 · MSAA 的枚举值是 3，不是 2

**文档原文（错误）**：
```ini
r.DefaultFeature.AntiAliasing=2   ; 2 = MSAA
```

**实际** —— `SceneView.cpp:236-246`（完整引文见 A12）：

```
0: off   1: FXAA   2: TAA   3: MSAA   4: TSR (Default)   5: SMAA
```

`EAntiAliasingMethod` 中 **MSAA = 3**，引擎默认值是 **4 (TSR)**。文档给出的 `=2` 实际会开成 TAA —— 在 VR 项目里这是一个会直接毁掉配置意图的错误。

---

## B4 · `r.GBufferFormat` 的取值含义写反了

**文档原文（错误）**：
> `r.GBufferFormat`  G-Buffer 精度：0=8bit, 1=默认, **3=16bit float, 5=高精度法线**

**实际** —— `Engine/Source/Runtime/Renderer/Private/SceneTextures.cpp:60-69`

```cpp
static TAutoConsoleVariable<int32> CVarGBufferFormat(
	TEXT("r.GBufferFormat"),
	1,
	TEXT("Defines the memory layout used for the GBuffer.\n")
	TEXT("(affects performance, mostly through bandwidth, quality of normals and material attributes).\n")
	TEXT(" 0: lower precision (8bit per component, for profiling)\n")
	TEXT(" 1: low precision (default)\n")
	TEXT(" 3: high precision normals encoding\n")
	TEXT(" 5: high precision"),
	ECVF_RenderThreadSafe);
```

**修正**：**3 = 高精度法线编码**，**5 = 全面高精度**。文档把 3 和 5 的含义对调了。

（`RenderUtils.cpp:2377` 的 `GetNormalQuality()` 也印证：`CVar->GetValueOnAnyThread() > 1 ? 1 : 0` —— 大于 1 即视为高质量法线。）

---

# C. 需要补充限定的论断

## C1 · 「延迟只需一遍几何」在 UE5 实践中基本不成立

**文档原文**：
> 几何提交次数：延迟 **1 遍（prepass 可选）** / 前向 **2 遍（强制）**

这在**渲染架构原理上正确**：延迟的 BasePass 只写 G-Buffer 很便宜，overdraw 浪费的是带宽而非光照，所以 prepass 不是正确性前提。

但回看 A10 的 `ShouldForceFullDepthPass`：

```cpp
return bNaniteEnabled || bAOCompute || bDBufferAllowed || bVirtualTextureEnabled
	|| bStencilLODDither || bEarlyZMaterialMasking
	|| IsForwardShadingEnabled(Platform) || IsUsingSelectiveBasePassOutputs(Platform);
```

**Nanite、DBuffer 贴花、虚拟纹理、Compute 版 AO、Masked 材质早出、Stencil LOD 抖动 —— 任意一项开启都会强制全量 prepass。** 一个典型的 UE5 延迟项目（开 Nanite + 虚拟纹理）**必然**跑全量 prepass。

**修正表述**：几何双提交是**前向的正确性前提**，是**延迟的常规实践**。真正的区别不在「跑不跑 prepass」，而在「不跑会怎样」—— 前向会得到错误的 overdraw 光照成本，延迟只是多写几遍 G-Buffer。

FIG 04 成本沙盘的建模口径注释已据此改写。

---

## C2 · `EncodeGBuffer` 自 5.7 起标记为 Substrate 弃用

`DeferredShadingCommon.ush:966`

```hlsl
// UE_DEPRECATED 5.7 - Deprecated by Substrate
/** Populates OutGBufferA, B and C */
void EncodeGBuffer(
	FGBufferData GBuffer,
	out float4 OutGBufferA,
	...
```

传统固定布局 G-Buffer 的编码函数已被标记弃用，但（见 A18）Substrate 默认仍关闭，所以**默认路径走的仍是这个被标记弃用的函数**。

**对文档的影响**：「固定布局锁死材质表达 → Substrate 是解法」的叙事被源码直接印证 —— Epic 已经在代码层面把旧路径标注为过渡态。但读者不应据此认为 5.8 已经切换；默认项目仍在旧布局上。

---

# D. 5.8 的新情况

这些在三份参考文档里都没有，但会影响读者的实际判断。

## D1 · MegaLights 取代 Clustered Deferred 成为多光源主路径

`Private/MegaLights/`（8 个文件）+ `Private/StochasticLighting/`

`LightRendering.cpp:1509-1513, 1548-1549`
```cpp
if (bHandledByMegaLights)
{
	SortedLightInfo->SortKey.Fields.LightSceneId = LightSceneInfo->Id.GetIndex() & LIGHT_ID_MASK;
	SortedLightInfo->SortKey.Fields.bHandledByMegaLights = true;
}
...
// Simple lights are ok to use with tiled and clustered deferred lighting unless they are handled by MegaLights
SortedLightInfo->SortKey.Fields.bClusteredDeferredNotSupported = bHandledByMegaLights;
```

光源排序阶段现在有**四个桶**（`LightRendering.cpp:1593-1611`）：
```
SimpleLightsEnd → ClusteredSupportedEnd → UnbatchedLightStart → 末尾
```
外加 MegaLights 单独摘出。文档中「延迟渲染分两条光照路径」的说法在 5.8 应更新为**三条**。

## D2 · Light Grid 支持分层（Parent Grid）与 HZB 剔除

`LightGridInjection.cpp:482-487`
```cpp
SHADER_PARAMETER_RDG_BUFFER_SRV(StructuredBuffer<uint>, ParentNumCulledLightsGrid)
SHADER_PARAMETER_RDG_BUFFER_SRV(StructuredBuffer<uint>, ParentCulledLightDataGrid32Bit)
SHADER_PARAMETER_RDG_BUFFER_SRV(Buffer<uint>, ParentCulledLightDataGrid16Bit)
SHADER_PARAMETER(FIntVector, ParentGridSize)
```

`LightGridInjection.cpp:107-113`
```cpp
int32 GLightGridHZBCull = 1;
FAutoConsoleVariableRef CVarLightGridHZBCull(
	TEXT("r.Forward.LightGridHZBCull"),
	GLightGridHZBCull,
	TEXT("Whether to use HZB culling to skip occluded grid cells."), ...);
```

即：先在粗网格上剔除，再细化；并用 HZB 跳过被遮挡的 cell。**默认开启。**

## D3 · 内置的 Light Grid 热力图调试视图

`LightGridInjection.cpp:87-105`
```cpp
int32 GForwardLightGridDebug = 0;
FAutoConsoleVariableRef CVarLightGridDebug(
	TEXT("r.Forward.LightGridDebug"), ...
	TEXT(" 1: on - showing light count onto the depth buffer\n")
	TEXT(" 2: on - showing max light count per tile ...\n"));

int32 GForwardLightGridDebugMaxThreshold = 8;   // r.Forward.LightGridDebug.MaxThreshold
```

想亲眼看 FIG 03 那张图在真实场景里的样子，直接开 `r.Forward.LightGridDebug 1` 即可 —— 比文档原先推荐的 `viewmode lightcomplexity` 更贴近本文讲的 froxel 网格。

---

# 附:核验用命令

```bash
# G-Buffer 结构与编解码
sed -n '379,439p'   Engine/Shaders/Private/DeferredShadingCommon.ush
sed -n '966,1033p'  Engine/Shaders/Private/DeferredShadingCommon.ush

# ShadingModel 枚举
sed -n '20,35p'     Engine/Shaders/Private/ShadingCommon.ush

# Light Grid 默认值与链表剔除
sed -n '71,137p'    Engine/Source/Runtime/Renderer/Private/LightGridInjection.cpp
sed -n '627,634p'   Engine/Source/Runtime/Renderer/Private/LightGridInjection.cpp
sed -n '721,740p'   Engine/Source/Runtime/RenderCore/Public/RenderUtils.h

# 延迟渲染器每帧构建前向光照网格
sed -n '2799,2815p' Engine/Source/Runtime/Renderer/Private/DeferredShadingRenderer.cpp

# 光源批处理分桶 / 代理几何
sed -n '1481,1512p' Engine/Source/Runtime/Renderer/Private/LightRendering.cpp
sed -n '3084,3094p' Engine/Source/Runtime/Renderer/Private/LightRendering.cpp

# Clustered Deferred 弃用
sed -n '36,65p'     Engine/Source/Runtime/Renderer/Private/ClusteredDeferredShadingPass.cpp

# 强制全量 Depth Prepass 的条件
sed -n '681,702p'   Engine/Source/Runtime/RenderCore/Private/RenderUtils.cpp
sed -n '4408,4453p' Engine/Source/Runtime/Renderer/Private/RendererScene.cpp

# 场景渲染器只有两个
grep -rn "class F.*SceneRenderer : public FSceneRenderer" Engine/Source/Runtime/Renderer/Private/
grep -rln "FForwardShadingSceneRenderer" Engine/Source/Runtime/Renderer/    # 预期 0 命中
```
