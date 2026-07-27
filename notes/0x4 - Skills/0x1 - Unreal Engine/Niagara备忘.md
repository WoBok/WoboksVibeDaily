---
title: "Niagara备忘"
date: "2026-07-13"
summary: "汇总 Niagara 粒子系统的常用配置、参数联动与自定义逻辑，作为特效制作中的操作备忘与问题排查参考。"
category: "Unreal Engine"
tags:
  - "Unreal Engine"
  - "Niagara"
  - "Sub UV"
  - "粒子系统"
---

## Niagara 随机选择 Sub UV 图案
1. 在 **Sprite Renderer → Sub UV** 中，将 **Sub Image Size** 设置为图集的行列数。  
  - 例如：4×4 图集设置为 `4, 4`。
2. 确认 **Sub Image Index Binding** 绑定为：

```latex
Particles.SubImageIndex
```

3. 在 **Particle Spawn** 中点击添加模块，搜索并添加：

```latex
Set new or existing parameter directly
```

4. 在该模块中添加参数：

```latex
Particles.SubImageIndex
```

5. 将参数值设置为：

```latex
Random Range Float
```

  - 随机范围设置为：

```latex
最小值：0
最大值：图案总数 - 1
```

  - 例如，4×4 图集共有 16 张图，范围设置为 `0～15`。

## 用自定义参数实现 Sprite Size 宽高联动

### 方法 1

1. 在 **Particle Spawn** 阶段,在 Initialize Particle **之前**加一个 **Set new or existing parameter directly**(Set Parameter)模块。
2. 新建一个 Particle 属性,比如 `Particles.SizeWidth`(类型 Float)。
3. 给 `Particles.SizeWidth` 的值用 Dynamic Input → **Random Range Float**,Min = 10,Max = 20。
4. 回到 Initialize Particle 的 Sprite Size(Non-Uniform 模式,或用 Make Vector 2D):
   - **X**:下拉选择 **Link Inputs → Particles → SizeWidth**
   - **Y**:下拉选择 **Dynamic Inputs → Multiply Float**,第一个输入 Link 到 `Particles.SizeWidth`,第二个输入填 2.0

### 方法 2

在 `Initialize Particle → Sprite Attributes` 中：

1. 将 **Sprite Size Mode** 设置为 `Non-Uniform`。
2. 点击 **Sprite Size（Vector2）** 右侧的下拉箭头。
3. 选择：
   `Dynamic Inputs → Multiply Vector2 by Float`
   部分版本可能显示为 `Multiply Vector by Float`。
4. 设置其中的 **Vector2**：

   * X = `1`
   * Y = `2`
5. 点击 **Float** 输入右侧的下拉箭头，选择：
   `Dynamic Inputs → Random Range Float`
6. 设置：

   * Minimum = `10`
   * Maximum = `20`

## 让粒子跟随 Actor 的 Scale
**使用Apply Owner Scale to Attributes 模块**  
在 Particle Update 里加这个模块，勾选希望跟随缩放的属性（SpriteSize / MeshScale / Velocity / Position 等）。之后直接在场景里拉 Actor 的 Scale 就能整体缩放。**注意它要放在会写这些属性的模块之后，否则会被覆盖掉。**

## Scratch Pad 核心要点

**是什么**：内嵌在 System/Emitter 资产内部的 Niagara 模块脚本。功能等同独立模块资产，只是不单独存在于内容浏览器，跟着宿主资产走。

**两种类型**
- **Scratch Module**：作为 Stack 上的一个模块节点，能读写属性、产生副作用
- **Scratch Dynamic Input**：作为某个输入引脚上的取值逻辑，只输出一个值，无副作用

**图结构**：`Map Get → 运算 → Map Set`
- `Module.` = 面板上可调的输入参数
- `Particles.` / `Emitter.` / `System.` / `User.` = 各级作用域参数

**主要用途**
1. 内置模块做不到的自定义粒子逻辑（运动、颜色、生成位置、条件 Kill）
2. 调用 Data Interface 的未暴露函数（骨骼网格采样、贴图采样、Grid、碰撞查询、样条、相机、跨 Emitter 读属性）
3. Simulation Stage 的迭代逻辑（流体等）
4. 内嵌 Custom HLSL 写数学密集部分

**必记两件事**
- 改完图必须点 **Apply**，否则 Stack 上不生效
- **Usage Bitmask** 要勾对阶段（Particle Spawn/Update 等），否则 Stack 里搜不到这个模块

## 水平面向相机
1. Particle Update 添加 Update Mesh Orientation模块
2. Orientation Method 选择 Orient To Vector(s)
3. 创建ScratchModule输出水平方向向量
   1. Map Get → Module.Camera Query → Get Camera Properties CPU/GPU → Camera Position World
   2. Camera Position World - Particles.Position
   3. Break Vector 上方结果， Make Vector 使用Break Vector的 x,y 分量，z保持0，进行Normalize
   4. 输出到Output Module
   5. Output Module中Outputs的Type选择Vector
4. 在 Update Mesh Orientation 模块的 Facing Direction 中选择刚才创建的Dynamic Input
### 1. 添加朝向模块

在 **Particle Update** 中添加 **Update Mesh Orientation** 模块。

### 2. 设置朝向方式

将 **Orientation Method** 设为 **Orient to Vector(s)**。

### 3. 创建 Scratch Dynamic Input 输出水平方向向量

新建一个 Scratch Dynamic Input，节点连接如下：

1. **获取相机位置**
   `Map Get` → 添加 `Module.Camera Query` 输入 → `Get Camera Properties CPU/GPU` → 取 **Camera Position World**
2. **获取粒子位置**
   `Map Get` → 添加 `Particles.Position`
3. **求指向向量**
   `Camera Position World` − `Particles.Position`
4. **投影到水平面并归一化**
   `Break Vector`（拆出上一步结果的 X / Y / Z）→ `Make Vector`，填入 **X、Y，Z 置 0** → `Normalize`
5. **输出**
   将结果连到 **Output Module**
6. 在 Output Module 的 **Outputs** 中，将 **Type** 设为 **Vector**

### 4. 应用到模块

回到 **Update Mesh Orientation**，在 **Facing Direction** 中选择刚创建的这个 Dynamic Input。
