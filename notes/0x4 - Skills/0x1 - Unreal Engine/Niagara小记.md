---
title: "Niagara小记"
date: "2026-07-13"
summary: "记录 Niagara 粒子在 Sprite Renderer 中配置 Sub UV 图集，并通过生成阶段参数随机选择子图案的方法。"
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