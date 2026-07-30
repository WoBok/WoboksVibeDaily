# 前向渲染与延迟渲染：从数据流建立心智模型

> 面向已经了解 Shader、光栅化、深度测试、Draw Call 和 Render Target 的读者。  
> UE5 部分以 Epic 的 UE 5.8 文档为参考；如果你使用其他 5.x 版本，应复查对应版本的功能矩阵。

## 1. 先记住本质

**前向渲染**：几何产生片元时，就计算该片元的材质与光照，直接写出最终颜色。

**延迟渲染**：几何产生片元时，先把最终可见不透明表面的属性写入 G-Buffer，等可见性基本确定后，再在屏幕空间统一计算光照。

最核心的分歧不是“谁更先进”，而是：

> **光照是在物体被光栅化时立即计算，还是在可见表面被记录后再计算。**

延迟渲染做的“决策反转”是：不再让每个几何片元立刻询问“哪些灯照我、我的颜色是什么”，而是先回答“这个屏幕位置最终看见哪个表面”，再让光照阶段处理这个可见表面。

它因此减少了对被遮挡表面的光照计算，但代价是必须保存和读取一份中间表面数据。**延迟的是光照，不一定是材质求值**：传统延迟渲染仍会在几何阶段运行材质代码，以生成 Base Color、法线、粗糙度等属性。

## 2. 两者共同在解决什么

一帧不透明物体的着色，可以拆成四个问题：

1. **几何处理**：顶点在哪里，经过模型、观察和投影变换后覆盖屏幕什么区域。
2. **可见性判断**：同一像素被多个三角形覆盖时，深度测试决定保留谁。
3. **材质求值**：纹理和材质逻辑生成表面的 Base Color、法线、粗糙度、金属度等。
4. **光照求值**：结合表面属性、观察方向、光源和阴影，计算出射颜色。

两条路径都必须完成这些工作。差别在于第 3、4 步是否与几何光栅化绑定在同一个主要 Pass 中，以及第 4 步发生前，可见性已经确定到什么程度。

## 3. 两条管线的数据流

### 3.1 前向渲染

```text
几何数据 → 顶点处理 → 光栅化/深度测试
        → 材质求值 → 查询相关光源 → 计算光照 → Scene Color
```

核心循环可以抽象为：

```text
for each opaque draw:
    rasterize geometry
    for each fragment that executes the pixel shader:
        surface = evaluate_material()
        lights = find_lights_affecting(fragment)
        color = surface.emissive
        for each light in lights:
            color += evaluate_BRDF(surface, light, view)
        write_color_and_depth(color)
```

材质结果只在当前片元着色器中短暂存在，光照立即消费它，最后直接写 HDR 场景颜色。若后来有更近的表面覆盖同一像素，先前算出的材质和光照可能全部作废。

不过，这不是说前向渲染一定会浪费这些工作。近到远排序、Early-Z（像素着色前的提前深度拒绝）和深度预通道都可能让被遮挡片元根本不执行昂贵着色。

### 3.2 延迟渲染

```text
几何数据 → 顶点处理 → 光栅化/深度测试 → 材质求值
        → G-Buffer（可见表面记录）
        → 光照阶段读取/解码 → Scene Color
```

```text
# Geometry / Base Pass
for each opaque draw:
    rasterize geometry
    for each fragment that passes the required depth test:
        surface = evaluate_material()
        write_gbuffer(surface, depth)

# Lighting Pass
for each visible pixel, tile, cluster, or light volume:
    surface = read_or_reconstruct_surface_from_gbuffer()
    for each relevant light:
        accumulate evaluate_BRDF(surface, light, view)
    write_scene_color()
```

Lighting Pass 既可以“逐光源处理它覆盖的像素”，也可以“逐 Tile/Cluster 处理候选光源列表”。循环的具体外层并非定义；本质是它只依赖屏幕空间的表面记录，不必重新执行原物体的材质。

## 4. 不要死记 `物体×光源` 与 `像素×光源`

这组说法只能描述某些朴素实现，不能作为两种架构的精确复杂度。更有用的变量是：

- `V`：需要处理的顶点数；
- `F_f`：前向路径中实际执行表面着色的片元数；
- `F_g`：延迟几何阶段实际执行材质并写 G-Buffer 的片元数；
- `P`：最终有不透明表面覆盖的可见像素或样本数；
- `k_f`、`k_d`：光源剔除后，每个着色点平均需要考虑的候选光源数；
- `C_m`、`C_l`：一次材质求值和一次单光源光照求值的成本；
- `B_g`：G-Buffer 每像素的读写量。

忽略阴影等共同成本，可以近似理解为：

```text
Forward  ≈ V + F_f × (C_m + k_f × C_l)

Deferred ≈ V + F_g × C_m
             + P × k_d × C_l
             + P × B_g
```

由此能直接推出：

- 当 Overdraw 大、深度拒绝不理想，使 `F_f` 远大于 `P` 时，延迟路径可避免给隐藏层做昂贵光照。
- 当深度预通道使 `F_f ≈ P`，且光源很少时，延迟路径的光照节省变小，G-Buffer 带宽反而可能成为纯额外成本。
- 若没有有效的光照剔除，`k` 会接近场景总光源数 `L`，两条路径都会随灯数快速变贵。
- Forward+、Tiled 和 Clustered 技术的核心作用，就是把 `k` 降下来；它们改变了“找哪些灯”的方式，而不必改变光照发生的阶段。

物体或 Draw 数主要影响 CPU 提交、顶点处理和潜在 Overdraw，并不会天然让每个像素与每个物体相乘。

## 5. 用同一个像素推演

假设场景有 100 个物体、10 盏动态灯。某像素最后只看见一个表面，真正影响它的灯有 4 盏。再假设绘制过程中有 3 层不透明表面曾覆盖这个位置。

### 前向路径

- 100 个物体都可能产生 Draw、顶点和光栅化成本，但只有覆盖该像素的三层与这个像素直接相关。
- 若绘制顺序差且 Early-Z 没能提前拒绝，三层都可能执行材质和光照；假设它们各受 4 盏灯影响，最坏会发生约 `3 ×（一次材质 + 4 次光照）`，前两层的颜色随后被覆盖。
- 若先画最近表面，或使用有效深度预通道，后两层可在昂贵着色前被拒绝，此时该像素接近只做一次材质和 4 次光照。
- 若实现没有光源剔除，它可能错误地遍历全部 10 盏灯；这属于朴素实现，不是“前向”的定义。

### 延迟路径

- 三层仍可能执行几何与材质、反复写 G-Buffer；因此延迟渲染**仍有 Overdraw**。
- 深度测试结束后，这个像素的 G-Buffer 只留下最前表面的记录。
- Lighting Pass 对这份记录读取一次，并计算 4 盏相关灯；被遮挡的两层不会再接受延迟光照。
- 深度预通道同样可以把多次 G-Buffer 写入压到接近一次。

因此，延迟路径真正稳定省下的是“隐藏表面的光照”，不是全部隐藏工作。前向路径配合良好的可见性和光源剔除后，两者的差距会明显缩小。

## 6. G-Buffer：延迟保存的表面契约

G-Buffer（Geometry Buffer）不是“若干张纹理”的简单集合，而是几何阶段与光照阶段之间的**数据契约**：前者承诺把后者需要的表面信息编码进去，后者只能使用这份记录恢复光照输入。

典型语义如下；具体通道打包因引擎、平台和材质系统而异。

| 表面信息 | 为什么需要 |
|---|---|
| Depth | 决定可见性，并配合像素坐标和逆视投影矩阵重建观察/世界空间位置 |
| Normal | 决定表面朝向，是漫反射、镜面反射和阴影响应的关键输入 |
| Base Color | 提供非金属漫反射颜色，或参与金属反射颜色 |
| Roughness | 控制高光瓣的宽窄与反射模糊程度 |
| Metallic / Specular | 决定介质与导体的反射参数 |
| AO、Emissive | 补充环境遮蔽或自发光信息；是否单独存储取决于实现 |
| Shading Model / Flags / Custom Data | 告诉 Lighting Pass 应如何解释这些槽位及选择哪套着色规则 |
| Velocity | 常用于 TAA、TSR 和运动模糊；它是常见附加屏幕缓冲，并非所有实现都把它视作核心 G-Buffer |

世界位置通常不直接保存，因为一个三分量高精度位置会占用大量空间；已知像素的屏幕坐标、深度和逆视投影矩阵，就能重建它。这样以少量算术换取显存和带宽。

固定契约也解释了延迟渲染的材质限制：若某种 BRDF 需要契约中没有的数据，就必须增加通道、压缩/复用 Custom Data、用 Shading Model ID 分支，或把该材质放进独立 Pass。材质越自由，中间记录通常越难保持紧凑。

### 一个带宽量级示例

假设有 4 张每像素 4 字节的表面附件，再加 4 字节深度，共 `20 B/像素`。这只是便于建立量级感的示例，并非 UE5 固定布局。

| 分辨率 | 一套附件容量 | 至少写一次再读一次 | 60 FPS 理论流量 |
|---|---:|---:|---:|
| 1920×1080 | 约 41 MB | 约 83 MB/帧 | 约 5 GB/s |
| 3840×2160 | 约 166 MB | 约 332 MB/帧 | 约 20 GB/s |

这里还没有计入 Overdraw、Scene Color、阴影、后处理、MSAA、额外 Pass 和缓存失效。另一方面，压缩、缓存与 Tile-Based GPU 的片上 Tile Memory 也可能减少外部显存流量。因此，“容量”不是“实际带宽”，表中的数字只能作为下限量级与缩放关系。

## 7. 优缺点如何从结构中产生

### 7.1 计算压力：光源、Overdraw、Early-Z

延迟路径先确定可见表面，所以大量动态局部光可以通过 Light Volume、Tile 或 Cluster 只作用于相关可见像素；隐藏表面不做这部分工作。前向路径若缺少剔除，材质 Shader 会携带并遍历过多灯光，成本和 Shader 复杂度都会上升。

但现代前向路径也能先为每个 Tile/Cluster 建立光源列表，并通过深度预通道减少 `F_f`。所以“大量灯光必选延迟”已经不是定律，真正要比较的是 `F`、`P`、`k`、材质成本和带宽。

### 7.2 数据压力：中间缓冲、缓存和移动 GPU

延迟路径要写入多张 MRT（Multiple Render Targets，多渲染目标）并在后续读取，因此更依赖带宽和缓存。前向路径直接写颜色，通常中间存储更少。

但“移动端一定适合前向”也不成立。许多移动 GPU 是 Tile-Based 架构，若 G-Buffer 能留在片上 Tile Memory 中完成光照，就可能避免大量外部显存往返；复杂动态光照下，移动延迟路径反而可能更有效。关键是目标 GPU、Render Pass/Subpass 实现和实际内容。

### 7.3 表示压力：透明、MSAA 和材质自由度

- **透明**：正确混合需要保留并按顺序处理同一像素的多个表面，而普通 G-Buffer 通常只保留最前一层，所以透明物体一般另走前向 Pass。不是“延迟不能画透明”，而是单层表面记录无法代表透明的多层合成问题。
- **MSAA**：边缘像素的不同样本可能属于不同三角形、拥有不同法线和材质。延迟路径若正确支持，就要按样本保存/读取 G-Buffer 并可能逐样本光照，存储和带宽随样本数放大；前向路径在片元着色时拥有完整表面上下文，结合 MSAA 更自然，但也绝非免费。
- **材质自由度**：前向 Shader 可在当前材质内直接执行特定光照逻辑；延迟 Lighting Pass 只能消费既定数据契约。ID、Custom Data 和可变 G-Buffer 能扩大能力，但都会增加分支、编码或内存成本。

### 7.4 系统压力：后处理与混合管线

延迟路径天然拥有深度、法线、粗糙度等屏幕空间数据，便于实现延迟贴花、SSAO 和某些屏幕空间效果。前向路径也能额外输出深度/法线来支持这些效果，但那会重新引入额外 Pass 或缓冲。

现实引擎通常是混合管线：不透明物体使用延迟或 Forward+，透明、毛发、粒子和特殊材质另走前向或专用 Pass；阴影、后处理也有各自阶段。因此项目选择的不是“一整帧只能属于一种算法”，而是主要不透明路径及其功能组合。

## 8. 常见误区

1. **“延迟一定更快。”**  
   错。少光源、低 Overdraw、带宽受限或需要 MSAA 时，G-Buffer 可能得不偿失。性能必须由具体场景和硬件决定。

2. **“前向无法处理大量光源。”**  
   错。Forward+ 和 Clustered Forward 能先做光源剔除，使每个片元只遍历小型候选列表。

3. **“延迟没有 Overdraw。”**  
   错。几何与 G-Buffer 仍可能被多层覆盖；延迟主要保证隐藏层不再接受后续延迟光照。

4. **“延迟不能渲染透明物体。”**  
   不准确。引擎通常在延迟不透明阶段之后，用前向透明 Pass 渲染它们。

5. **“前向会让每个物体遍历场景全部光源。”**  
   只对朴素实现成立。物体光源列表、Tile 和 Cluster 都可以缩小候选集合。

6. **“延迟的优势是减少 Draw Call。”**  
   错。物体仍要提交并栅格化；延迟重排的是表面信息与光照的数据流，不会天然减少 Draw Call。

7. **“只要使用 G-Buffer，就是传统延迟渲染。”**  
   错。某些前向或混合路径也会输出法线、速度等缓冲；Visibility Buffer 则保存几何身份后再延迟材质求值。要看数据存了什么、谁消费它、光照何时发生。

## 9. 现代方案不是二选一

可以把现代渲染架构拆成三个相对独立的决策：

1. **何时确定可见性**；
2. **在阶段之间保存多少表面信息**；
3. **如何把光源剔除到像素、Tile 或 Cluster**。

由此可定位常见方案：

- **Forward+ / Tiled Forward**：仍在几何片元阶段完成光照，但先按屏幕 Tile 建立光源列表，降低 `k_f`。
- **Clustered Forward**：在屏幕 Tile 上再加入深度切片，减少跨深度范围的无关灯光。
- **Tiled / Clustered Deferred**：仍先写 G-Buffer，只优化 Lighting Pass 的光源查找。
- **Deferred Lighting**：先累计较通用的光照结果，再由材质阶段组合；它与 Deferred Shading 的拆分边界不同。
- **Visibility Buffer**：先只保存三角形/实例身份、深度或重心坐标，之后再取回几何与材质数据。它把“延迟”推进到材质求值，而传统 G-Buffer 延迟的主要是光照。
- **Hybrid Rendering**：给不透明、透明、毛发、粒子和特殊材质选择不同路径。这是现代引擎的常态。

所以真正成熟的心智模型不是“Forward 与 Deferred 两个套餐”，而是：**可见性、表面表示、光源剔除和光照时机组成了一条设计连续谱。**

## 10. 映射到 Unreal Engine 5

以下是 UE 5.8 文档中的实现事实，不应误认为图形学上的必然规律：

- UE 桌面项目默认使用 Deferred，因为它提供更广的功能覆盖；可在 `Project Settings > Rendering > Forward Shading` 开启桌面 Forward，之后需要重启。
- UE 的桌面 Forward 不是“每个物体遍历全部灯”的朴素实现。引擎会把灯光和 Reflection Capture 剔除到视锥空间网格，每个像素只遍历所在单元的候选列表；从心智模型看，它具有 Forward+ 的关键思想。
- Deferred 路径的 Base Pass 主要生成不透明表面数据，局部直接光在后续阶段读取这些数据；Forward 则在 Base Pass 内完成主要材质与候选光照。两条路径还都有深度、阴影和后处理等阶段。
- 传统或固定布局的 UE G-Buffer 可看到 Normal、Metallic、Specular、Roughness、Base Color 和 Shading Model 等字段。Shading Model ID 的作用是告诉后续光照代码“按哪套规则解释这些数据”，但它并不提供无限的材质自由度。
- 截至 UE 5.8 的桌面功能矩阵，Lumen、Nanite 和 Virtual Shadow Maps 不支持 Desktop Forward。这是 UE 当前产品实现的功能约束，不代表这些技术在理论上必然依赖延迟渲染。
- Forward 支持 MSAA，因此部分 VR 项目会用 Forward + MSAA 换取更稳定、清晰的几何边缘；代价是 MSAA 成本以及部分 Deferred 功能不可用。VR 不是必须选择 Forward，仍应以目标头显实测。
- Mobile Forward 与 Mobile Deferred 是移动渲染器自己的两条路径，不等同于桌面版本。UE 5.8 文档中 Mobile Forward 仍是默认；预计算光照项目更适合它，而复杂动态光照在支持 Tile Memory 的设备上可能更适合 Mobile Deferred。
- UE 5.7 以后 Substrate 的默认状态及 Blendable/Adaptive G-Buffer 改变了部分材质数据表示。学习固定通道和 Shading Model ID 很有价值，但不要把它当成所有 UE5 版本与材质配置的唯一实现。

### 三个立刻可做的 UE 实验

1. **观察表面记录**  
   在 Deferred 路径下打开 `Buffer Visualization`，查看 Base Color、World Normal、Roughness、Metallic 和 Scene Depth；再用 `Tools > Debug > Pixel Inspector` 检查同一像素。你看到的不是最终颜色，而是 Lighting Pass 的输入。

2. **观察成本搬到了哪里**  
   在固定相机、分辨率和灯光下使用 `stat gpu` 或 GPU Profiler。逐步增加互相重叠的动态点光源，观察 Base Pass、Lighting/Lights 和 Translucency 的时间变化。总帧率只能告诉你“变慢了”，Pass 分布才能解释“成本在哪里”。

3. **同场景切换路径**  
   开启或关闭 `Forward Shading`，重启并等待 Shader 重编译。保持场景与画质设置一致，比较可用的 Buffer、抗锯齿选项和 GPU Pass 分布。不要期待只改一个开关就得到公平性能结论；还要按各路径重新选择适合的功能设置。

## 11. 项目选择框架

按以下顺序判断：

1. **先看硬约束**：项目是否必须使用当前 UE 版本中只支持 Deferred 的功能，或必须使用 MSAA？硬约束优先于理论性能。
2. **再看主要像素成本**：大量重叠动态灯、昂贵材质、高 Overdraw、还是大面积透明/毛发/粒子占主导？
3. **检查光源剔除**：不要拿朴素 Forward 与优化后的 Deferred 比，也不要拿 Forward+ 与没有 Tile/Cluster 的旧式延迟实现比。
4. **检查硬件瓶颈**：桌面独显、Tile-Based 移动 GPU 与 VR 头显的带宽、缓存和抗锯齿需求不同。
5. **最后测量**：在目标设备上使用相同画面、相同分辨率和明确的功能集，比较 Pass 时间、带宽迹象与画质，而不是只看平均 FPS。

一个实用结论是：

- 大量不透明表面、动态局部灯和依赖屏幕空间/UE 高端功能的桌面项目，通常从 Deferred 起步。
- 强调 MSAA、VR 清晰度、较少灯光或可严格控制功能集的项目，可以优先验证 Forward。
- 大量透明、毛发和粒子不会因选择 Deferred 自动受益，因为它们往往仍走前向或专用路径。
- 移动端不能只按“Forward 更省”判断，必须结合 Tile Memory、动态光照比例与真机验证。

## 12. 自测：能回答才算真正理解

1. **场景灯数从 100 增到 1000，但每个 Cluster 的平均候选灯数仍为 4，像素光照是否必然变成 10 倍？**  
   答案要点：不会。像素阶段仍近似处理 4 盏；光源列表构建、剔除和内存成本会增加，但不是每像素直接乘 10。

2. **深度预通道使前向路径几乎只着色最终可见片元后，延迟的优势是否消失？**  
   答案要点：隐藏片元的光照优势大幅缩小，但 Deferred 仍有集中光照、数据复用和功能集优势，也仍承担 G-Buffer 带宽与表示限制。

3. **为什么普通单层 G-Buffer 难以直接处理玻璃后面的烟雾？**  
   答案要点：一个像素需要按深度保存并组合多个表面，单层 G-Buffer 只记录一个可见表面。

4. **为什么世界位置通常不存进 G-Buffer？**  
   答案要点：可由像素坐标和深度重建；用少量算术换取每像素多个字节的存储与带宽。

5. **Forward+ 为什么仍然是 Forward？**  
   答案要点：Tile/Cluster 只改变光源候选列表的生成方式；材质与光照仍在几何片元着色时一起完成并直接写颜色。

## 13. 不超过 200 字的记忆版

前向渲染在几何片元着色时同时求材质与光照，直接写颜色；延迟渲染先把最终不透明表面的属性写入 G-Buffer，再统一求光。延迟用中间存储和带宽换来“可见后再照明”，所以擅长大量动态灯，却天然面对透明、多样材质和 MSAA 的表示成本。现代 Forward+、Clustered 与混合管线说明：真正的选择是可见性、表面数据、光源剔除和光照时机的组合。

## 参考资料

- [Epic：Forward Shading Renderer](https://dev.epicgames.com/documentation/unreal-engine/forward-shading-renderer-in-unreal-engine)
- [Epic：Supported Features by Rendering Path — Desktop and Desktop XR](https://dev.epicgames.com/documentation/en-us/unreal-engine/supported-features-by-rendering-path-for-desktop-with-unreal-engine)
- [Epic：Mobile Rendering and Shading Modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/mobile-rendering-and-shading-modes-for-unreal-engine)
- [Epic：Pixel Inspector](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-inspector-in-unreal-engine)
- [Epic：Viewport Buffer Visualization](https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-modes-in-unreal-engine)
- [Epic：Substrate Materials Overview](https://dev.epicgames.com/documentation/unreal-engine/overview-of-substrate-materials-in-unreal-engine)
