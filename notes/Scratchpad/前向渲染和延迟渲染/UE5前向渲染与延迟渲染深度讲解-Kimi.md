# UE5 视角下的前向渲染（Forward）与延迟渲染（Deferred）

> 面向读者：有图形管线基础（顶点/片元着色器、深度测试、光栅化、Render Target、Draw Call），会用 UE 编辑器但没读过渲染源码的技术美术与引擎初学者。
> 目标：建立一个能用来分析实际渲染问题的心智模型，而不是背一张优缺点对照表。
> 说明：文中涉及具体引擎行为处均注明"这是 UE5 的行为"；随版本变化大的行为会提醒你核对自己所用版本的官方文档。

---

## 1. 一句话本质 + 类比

**前向渲染（Forward Rendering）**：每个物体被绘制时，当场把材质和光照一次性算完，直接写出最终颜色——"当场结账"。

**延迟渲染（Deferred Rendering）**：先把"屏幕上每个像素的表面属性是什么"存进一组叫 G-Buffer（几何缓冲，Geometry Buffer）的 Render Target，光照计算延后到屏幕空间统一执行——"先记账，后结算"。

两者的本质差异不是"谁更快"，而是一次**决策反转**：

- 前向：光照计算**跟着几何走**——画哪个三角形，就在那个三角形的光栅化过程中算光照。
- 延迟：光照计算**跟着像素走**——先把"每个屏幕像素上最终可见的表面"物化（materialize）成数据，再对屏幕像素做光照。

生活化类比：

- 前向像**街边大排档**：你点一份炒一份，厨师当场把食材（材质）和调味（光照）一起下锅端给你。客人少（光源少）时又快又直接；客人一多，每桌都要等厨师把所有调料重复放一遍。
- 延迟像**自助餐结算台**：所有菜先做好摆在台面上，把每道菜的信息登记成卡片（G-Buffer），最后到结算台统一结账（统一算光照）。前期摆台成本高（显存和带宽），但客人再多，结账这一步只按"你盘子里实际装了什么"收费，跟后厨做过多少道菜无关。

因为这个决策反转，后文所有差异——复杂度、显存、功能绑定——都是它的推论，而不是孤立的事实。

---

## 2. UE5 中的路径分布（这是 UE5 的行为）

**桌面/主机端**：默认走延迟路径，渲染器类是 `FDeferredShadingSceneRenderer`。这是 UE5 的行为，也是大多数功能的"主场"。

**桌面前向**：开关在 Project Settings → Rendering → **Forward Shading**，开启后需要重启编辑器并重编译材质。典型用途是 VR 项目、需要 MSAA 的项目。注意一个关键事实：UE 的桌面前向**不是教科书上"每个像素遍历所有灯"的朴素前向**，而是 **Clustered Forward**——CPU 侧把视锥划分成三维 cluster（簇）网格，为每个 cluster 建立一个光源列表；像素着色时只计算本 cluster 内的光源。因为光源筛选提前到了空间格子层面，所以"前向=光源一多就爆"的朴素结论在 UE 桌面端并不直接成立（真正受限的是单个 cluster 内重叠的光源数，见第 9 节）。

**移动端**：默认是 **Mobile Forward**。UE5 提供 **Mobile Deferred Shading**（在 5.x 各版本中逐步成熟），开关位置：Project Settings → Engine - Rendering → Mobile → Mobile Shading → **Deferred Shading**。它的关键设计是把 G-Buffer 放在 GPU 的 tile memory（片上瓦片内存）内，不落系统内存；在支持 memoryless / LAZILY_ALLOCATED（惰性分配）的设备上更省显存。因为移动端 SoC 是 tile-based 架构，片上内存读写几乎不占外部带宽，所以"延迟渲染带宽开销大"这条桌面结论在移动端被大幅削弱——但这条推论成立的条件是设备与引擎版本都支持。**提醒：Mobile Deferred 的成熟度随版本变化很大，请核对你所用版本的文档。**截至 2026 年中，UE 版本线已到 5.7/5.8。

---

## 3. 流程拆解（映射到 UE 的实现）

### 3.1 前向路径

文字流程图：

```
几何 → 顶点处理 → 光栅化 → 片元着色（材质 + 光照 + 阴影 + 雾 一次算完）→ 写入 SceneColor
```

在 UE 里，这对应 **BasePass**：每个 draw 在 BasePass 中直接完成光照并写入 SceneColor（场景颜色 RT）。光照、阴影采样、雾都在这一个 pass 内完成——VR/Forward 下默认开启 **Vertex Fogging**（顶点雾，把雾计算挪到顶点阶段以省片元开销），这是 UE5 的行为。

### 3.2 延迟路径

```
BasePass：几何 → 光栅化 → 只写表面属性到 G-Buffer（不算光照）
Lights pass：逐光源读取 G-Buffer → 对受影响像素算光照 → 累加进 SceneColor
```

BasePass 在这里退化成"记录员"：它输出的不是颜色，而是"这个像素上是什么表面"。光照被推迟（deferred）到后续的 Lights pass。

### 3.3 UE5 桌面端 G-Buffer 布局（已核实，按此讲）

- **GBufferA**：世界空间法线（World Normal）
- **GBufferB**：Metallic / Specular / Roughness / ShadingModel ID（+ SelectiveOutputMask）
- **GBufferC**：BaseColor / AO
- **GBufferD**：CustomData（如 Clear Coat 参数、次表面参数）
- **GBufferE**：预计算阴影因子
- 另有 **SceneDepth** 与 **Velocity**（速度缓冲，供 TAA/TSR/运动模糊用）

一个值得追问的细节：**世界空间位置不存**。因为位置可以由深度 + 相机参数（投影矩阵的逆）在光照阶段数学重建，所以省下了一整个通道的显存与写入带宽——用一点点光照阶段的 ALU 换显存，这正是延迟渲染"用算力换带宽"的典型取舍。

### 3.4 ShadingModel ID：UE 延迟路径支持多材质模型的钥匙

经典延迟渲染的著名短板是"材质模型单一"：因为光照在屏幕空间统一执行，天然倾向于全场使用同一个 BRDF。UE 的解法是：在 GBufferB 里给每个像素存一个 **ShadingModel ID**（着色模型编号），Lights pass 在着色时按这个 ID 分支，执行对应的光照模型（Default Lit / Clear Coat / Hair / Eye 等）。

因果关系要理清：因为材质模型被**编码进了 G-Buffer**、光照 pass 做**逐像素分支**，所以"材质单一"的短板被缓解了；代价同样由这个设计直接推出——G-Buffer 必须预留通道存 ID 和各模型可能用到的 CustomData，光照 shader 变成一个包含所有模型分支的巨型 uber-shader，更复杂、寄存器压力更大。

可以顺带一提：**Substrate**（UE 的新一代分层材质框架，官方称自 5.7 起 production-ready；请以你所用版本文档为准）用更丰富的 buffer 与 closure（闭包，即把材质表示为可组合的光照算子）组合进一步扩展材质表达，但因为 G-Buffer 每像素字节数预算更紧，它对显存和带宽的压力也更大——这又是同一个权衡的延续。

---

## 4. 设计动机与复杂度分析

先把两类渲染的成本结构写成公式：

- **前向**：光照成本 ≈ O(几何覆盖的像素数 × 光源数)。因为光照在画几何的同一个 pass 里做，所以**每一个被光栅化的片元**都要做光照——包括随后被深度测试淘汰、或被更近表面覆盖的片元（overdraw，重复绘制）。遮挡掉的几何照样"结过账"。
- **延迟**：成本 ≈ BasePass O(几何光栅化) + 光照 pass O(受光源影响的屏幕像素数 × 光源数)。因为光照只对着 G-Buffer 里**已经决出胜负的最终可见表面**做，所以光照与几何复杂度**解耦**了：场景里摆多少三角形，光照 pass 的成本几乎不变。

用"夜晚城市、100 盏动态点光源"推演一遍。分析时不断问自己四个问题：哪些计算随物体数变？哪些随光源数变？哪些随屏幕像素数变？哪些花在了不可见表面上？

- 前向路径下：每个 fragment 要遍历（或经 cluster 筛选后）的光源并逐个计算。100 盏灯，哪怕 cluster 剔除后剩 10 盏，每个片元也要算 10 次光照；如果这个像素被 3 层几何 overdraw，不可见的 2 层也各算了 10 次——**白算**。
- 延迟路径下：BasePass 先把所有几何光栅化、深度测试决出每个像素的赢家写进 G-Buffer；然后每盏灯只对自己屏幕包围范围内的像素着色一次。被遮挡的表面**不产生任何光照开销**——它们在深度测试时就被淘汰了，根本没进 G-Buffer。

所以延迟的动机可以压缩成一句：把光照成本的上限从"几何 × 光源"改写为"屏幕像素 × 光源"，并以 overdraw 上的光照浪费为零作为附带收益。成立条件：场景光源多、几何复杂度高；反过来，光源很少、几何简单的场景里，G-Buffer 的固定开销可能收不回本（见第 6 节）。

再补一个容易忽略的推论：因为延迟路径里光照是"逐光源画一个屏幕空间体积（点光源画球、聚光灯画锥）"，所以光源的成本还随它在屏幕上的**投影面积**变化——一盏贴脸的大点光源比十盏远处的小光源更贵。这意味着延迟路径下灯光师可以用"光源影响半径"直接控制开销：把无关紧要的小灯半径调小，受影响像素变少，光照成本立刻下降。前向路径里半径同样参与 cluster 剔除，但因为光照在 BasePass 内逐 draw 执行，收益没有延迟路径那样"每盏灯独立、可预测"。这是"光照跟着像素走"带来的可操作性红利。

---

## 5. 引擎功能 × 渲染路径绑定表（已核实）

在 UE5 里，渲染路径不是孤立的性能开关，而是功能的地基。下表是 UE5 的行为：

| 功能 | 延迟路径 | 前向路径 | 原因（结构性，非"还没做"） |
|---|---|---|---|
| Nanite | ✅ 仅延迟 | ❌ | 可见性缓冲 + 材质分类的架构与 G-Buffer 流程共生；早期 SIGGRAPH 资料即列 "No Forward Rendering" |
| Lumen | ✅ 实际绑定延迟 | ❌ | 依赖 G-Buffer 做屏幕空间追踪等；官方文档称 VR 不支持、移动端支持有限 |
| Substrate | ✅ 完整功能 | 受限 | 部分能力（如 Diffusion 次表面）仅 deferred / 路径追踪 |
| MSAA | ❌ | ✅ 仅前向可用 | 延迟路径下 G-Buffer 多样本存储 + 每样本着色代价过高，是结构性原因；延迟用 TAA/TSR |
| TSR / TAA | ✅ | ✅ | 路径无关，是延迟路径的主力抗锯齿方案 |
| Virtual Shadow Maps | ✅ UE5 默认阴影系统，延迟路径下验证最完整 | 支持受限 | 以所用版本文档为准（此处保持谨慎措辞） |

结论：**在 UE5 里选渲染路径，本质是选功能集，而不只是选性能。**你想要 Nanite + Lumen 的场景，延迟不是"推荐项"而是前提；你必须要 MSAA 的 VR 项目，前向也不是"可选项"而是前提。

---

## 6. 代价与权衡

### 6.1 G-Buffer 的显存与带宽

G-Buffer 是多个全屏 Render Target。量级估算（标"估算"）：1080p 下一张 RGBA8 全屏 RT 约 8MB，GBufferA~E 加 SceneDepth、Velocity，整套 G-Buffer 是数十 MB 量级；每帧先整套写入、光照阶段再整套读回，产生的是每帧数百 MB 量级的带宽（估算，实际取决于格式与分辨率）。

因果链：因为延迟路径把"表面属性"物化成了全屏数据，所以显存占用和内存带宽随**分辨率**线性增长——这是延迟路径在带宽敏感平台（移动端、VR）吃亏的根因。移动端的 Mobile Deferred 正是用 tile memory 片上化来攻击这个根因（第 2 节）。

### 6.2 透明物体：延迟覆盖不了的盲区

因为一个 G-Buffer 像素只能存**一个**表面的属性，而透明的本质是一个像素里多个表面前后叠加，所以延迟路径在结构上覆盖不了透明物体。UE 的做法：透明物体走独立的 **Translucency pass**，其光照方式是前向式的；透明材质的 Lighting Mode 常用 **Surface ForwardShading**。已核实：Mobile Deferred 文档明确写道 translucency passes **always** use forward shading。所以即使你开了延迟，你的工程里也始终活着一个小型前向渲染器。

### 6.3 Forward 路径的官方限制（已核实，这是 UE5 的行为）

- 不支持屏幕空间技术：SSR（屏幕空间反射）、SSAO（屏幕空间环境光遮蔽）、Contact Shadows——因为它们都依赖延迟路径才有完整 G-Buffer 供屏幕空间采样；
- 不支持动态阴影投射到半透明；
- 材质无法采样 GBuffer SceneTexture 节点；
- 单 pass 材质可用的纹理 sampler 更少；
- MSAA 相对 TAA 约 +25% GPU 帧时间（官方给出的量级，实际以工程为准）。

### 6.4 为什么 VR 项目常开 Forward + MSAA

推演链：VR 是双眼高分辨率 + 90Hz 刚需 → 每帧像素量大、帧时间预算仅约 11ms → 带宽敏感 → G-Buffer 的固定带宽开销不划算，所以前向更有吸引力；同时头显带来持续的亚像素级头部运动，TAA/TSR 这类时序抗锯齿（靠历史帧累积）会糊、会闪，而 MSAA 是单帧内的几何多样本，画面更干净。代价是无 Lumen 等延迟绑定功能——这是 VR 项目普遍接受的交换。注意这个结论成立的条件是"VR + 高帧率刚需 + 亚像素运动"，不是"VR 永远该用前向"。

---

## 7. 编辑器动手验证（可立即做的实验）

1. **亲眼看 G-Buffer**：视口 View Mode → **Buffer Visualization** → Overview / BaseColor / World Normal / Roughness / Shading Model。逐项切换，对照第 3.3 节的布局——你会看到 World Normal 是一张彩色法线图，Shading Model 通道里不同材质呈现不同色块。
2. **看开销分布**：控制台输入 `stat gpu`，或按 **Ctrl+Shift+,** 打开 ProfileGPU，观察 BasePass 与 Lights（延迟路径）的开销占比；再去光源多的场景对比两者比例如何此消彼长。
3. **验证 MSAA 绑定**：新建空白项目 → Project Settings → Rendering → 开 **Forward Shading** → 重启编辑器。重开后看 Anti-Aliasing Method 里 **MSAA 变为可选**；用 `r.MSAACount 0` / `r.MSAACount 4` 切换对比边缘质量与帧时间。
4. **双路径压力对比**：同一关卡摆几十个相互重叠的动态点光源，分别在默认延迟和 Forward 下用 ProfileGPU 对比 GPU 帧时间与画面差异（注意 Forward 下 SSR/SSAO 等会消失，这本身就是观察点）。
5. **移动端预览**：视口 Preview Rendering Level 切到 Android，再切换 Project Settings 里 Mobile Shading 的 Forward / Deferred 看差异——提醒：需要对应设备与引擎版本支持，以文档为准。

---

## 8. 源码指引（可选深入，推荐阅读顺序）

按"从总到分、跟着数据流走"的顺序读：

1. `Renderer.cpp` 的 `FSceneRenderer::Render`——渲染总入口，先看一帧的整体骨架，知道有哪些大 pass。
2. `FDeferredShadingSceneRenderer`（`DeferredShadingRenderer.cpp`）vs `FForwardShadingSceneRenderer`（`ForwardShadingSceneRenderer.cpp`）——两条路径的分叉点，对照看"什么被推迟了"。
3. `BasePassRendering.h/.cpp`——BasePass，两条路径共用框架但 shader 变体不同：延迟变体写 G-Buffer，前向变体直接算光照写 SceneColor。读完这里，第 3 节的流程图就落地成了代码。
4. `LightRendering.cpp` / 延迟光照相关 shader（DeferredLightPixelShaders）——逐光源读 G-Buffer、累加光照的地方，对应 ShadingModel ID 分支。
5. `TranslucencyRendering.cpp`——透明前向 pass，验证"延迟引擎里也活着一个前向渲染器"。
6. `Nanite/` 目录——可见性缓冲（Visibility Buffer）实现，理解它为什么与 G-Buffer 流程共生。

---

## 9. 常见误区

**误区 1："延迟更先进，所以永远该用。"**
错在把"功能多"当"性能优"。移动端/VR 等带宽敏感场景前向更合适，UE 移动端默认至今仍是 Forward。部分成立的条件：桌面/主机 + 需要 Nanite/Lumen 的场景，延迟确实几乎是唯一选择。正确说法：路径选择是功能集与带宽预算的联合决策。

**误区 2："开 Forward 只是光照挪了个位置。"**
错在忽略了功能绑定：Lumen/Nanite/Substrate 不可用或受限，AA 体系从 TAA/TSR 切换到 MSAA 可用，SSR/SSAO 等屏幕空间效果整体丢失（第 5、6 节）。正确说法：开 Forward 是换了一整个渲染器与功能集，不是改了一个光照时机。

**误区 3："延迟渲染没有 overdraw。"**
错在混淆了两种 overdraw。BasePass 的几何 overdraw 依然存在——被遮挡的片元照样被光栅化、照样跑材质采样（深度测试只能淘汰写入，淘汰不了已发生的着色，除非靠早期深度剔除等机制缓解）。省掉的只是**光照的重复计算**。正确说法：延迟消除的是光照 overdraw，不是几何 overdraw。

**误区 4："前向渲染处理不了多光源。"**
错在拿朴素前向套 UE。UE 的 Clustered Forward 有光源剔除，每像素只算本 cluster 内的光源。部分成立的条件：单个 cluster 内重叠光源很多、或单 pass 材质复杂度过高时，前向光照成本仍会失控。正确说法：前向的天花板是"局部光源密度 × 材质复杂度"，不是光源总数本身。

**误区 5："延迟渲染的核心优势是减少 Draw Call。"**
错在抓错了主因。延迟的核心优势是**光照与几何解耦**（第 4 节）；Draw Call 数量上两者差别不大——延迟甚至因为 BasePass 各 draw 的渲染状态更统一、CPU 侧状态管理更省，这是附带收益而非核心。正确说法：Draw Call 不是区分两条路径的维度。

---

## 10. 自测与记忆版

### 10.1 核心问题（能区分"真懂"与"背结论"）

1. **为什么说延迟渲染把光照和几何"解耦"了？请用成本公式说明。**
   要点：前向光照 ≈ O(几何像素 × 光源)，含不可见表面；延迟 = BasePass O(几何) + 光照 O(受影响屏幕像素 × 光源)，光照只作用于深度测试后的最终表面。
2. **UE 的延迟路径为什么还能支持 Clear Coat、Hair 等多种着色模型？代价是什么？**
   要点：ShadingModel ID 编码进 GBufferB，Lights pass 逐像素分支；代价是 G-Buffer 预留通道、光照 uber-shader 变复杂。
3. **G-Buffer 为什么不存世界空间位置？这体现了什么取舍？**
   要点：可由深度 + 相机参数重建；用光照阶段的 ALU 换一个通道的显存与带宽。
4. **为什么 MSAA 在延迟路径下是"结构性不可用"而不是"还没实现"？**
   要点：MSAA 要求 G-Buffer 每像素存多个样本、每样本独立着色，显存与光照成本成倍放大，与"物化表面属性"的设计冲突。
5. **开了延迟渲染，透明物体的光照在哪里算？**
   要点：独立 Translucency pass，前向式；材质 Lighting Mode 常用 Surface ForwardShading；Mobile Deferred 文档明确 translucency 永远走 forward。

### 10.2 场景判断题

1. **"为什么玻璃材质在延迟路径下仍要算两次光照成本？"**
   思路：玻璃是透明物体 → G-Buffer 一个像素只能存一个表面 → 玻璃本身不进 G-Buffer，走 Translucency 前向 pass 算一次光照；它背后的不透明表面已进 G-Buffer、在 Lights pass 算过一次。两次开销的来源不同，叠加在最终画面里。
2. **"VR 项目要求 90Hz、画面不能糊，技术负责人建议开 Forward，他的推理链是什么？他要放弃什么？"**
   思路：双眼高分辨率+90Hz → 带宽敏感 → G-Buffer 固定开销不划算；头显亚像素运动 → TAA/TSR 时序 AA 会糊 → 需要 MSAA → MSAA 仅前向可用。放弃：Lumen、Nanite、SSR/SSAO 等延迟绑定功能。
3. **"场景里只有 3 盏灯但三角形极多，同事说'上延迟肯定更快'，对吗？"**
   思路：不一定。延迟的收益随光源数放大，光源少时光照解耦收益小，而 G-Buffer 的显存与带宽固定开销照付；几何极多倒是 Nanite 的适用场景——选延迟的真正理由往往是功能集（Nanite），而不是光照性能。

### 10.3 最终记忆版（<200 字）

前向是"跟着几何走、当场结账"，延迟是"先把表面属性记进 G-Buffer、光照跟着屏幕像素走后结算"——本质是一次决策反转。因此延迟把光照成本与几何解耦，代价是 G-Buffer 的显存带宽，且一个像素只能记一个表面，透明永远走前向。UE5 桌面默认延迟，前向实为 Clustered Forward；移动默认前向。在 UE5 选路径 = 选功能集：Nanite/Lumen/Substrate 绑延迟，MSAA 只属前向，VR 因此常选前向。记住因果链，优缺点表自然推导出来。
