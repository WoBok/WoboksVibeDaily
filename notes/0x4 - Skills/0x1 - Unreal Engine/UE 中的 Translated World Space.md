---
title: "UE 中的 Translated World Space"
date: "2026-09-20"
summary: "解释 UE 中 Translated World Space 的坐标变换、与世界和观察空间的区别、PreViewTranslation 用法，以及改善大世界渲染精度的原理与注意事项。"
category: "Unreal Engine"
tags:
  - "Unreal Engine"
  - "Translated World Space"
  - "PreViewTranslation"
  - "LWC"
  - "坐标空间"
  - "渲染精度"
---

**Translated World Space（平移后的世界空间），就是把世界坐标系的原点移到相机附近，同时保持世界坐标轴的方向不变。**

这里的 Translated 指数学上的“平移”。它让相机附近的位置用更小的数值表示，从而提高渲染计算的精度。

以下以普通相机视图为例，把相机位置作为新原点；实际使用时，以引擎提供的平移量和矩阵为准。

## 1. 坐标空间转换示例

假设相机和物体的世界坐标分别为：

```text
相机 C = (1,000,000,  0,  0)
物体 P = (1,000,100, 50, 20)
```

把原点移到相机位置，物体的新坐标就是：

```text
Translated World Position = P - C
                          = (100, 50, 20)
```

意思是：**从相机出发，沿世界 X 轴走 100、Y 轴走 50、Z 轴走 20，就能到达物体。**

物体没有移动，只是描述它的位置时换了一个原点。

## 2. 与 World Space、View Space 的区别

| 空间 | 原点 | 坐标轴方向 |
|---|---|---|
| World Space（世界空间） | 世界原点 | 世界坐标轴方向 |
| Translated World Space（平移后的世界空间） | 相机位置 | **仍是世界坐标轴方向** |
| View Space（观察空间） | 相机位置 | 按相机朝向确定的观察坐标轴方向 |

转换过程可以理解为：

```text
World Space
    │ 减去相机位置：改变原点
    ▼
Translated World Space
    │ 转换到观察坐标轴方向
    ▼
View Space
    │ 投影
    ▼
Clip Space（裁剪空间）
```

**从 Translated World Space 到 View Space，不需要先还原 World Position。** 直接把已有的相对位置转换到观察坐标轴即可。  
在 View Space 中，相机位于坐标系原点。

一个直观的判断方法：相机站在原地转头时，固定物体的 Translated World Position 不变，而 View Position 会变化。

## 3. UE 中的 PreViewTranslation

UE 用 `PreViewTranslation` 表示这个平移量，坐标关系是：

```text
TranslatedWorldPosition = WorldPosition + PreViewTranslation
WorldPosition = TranslatedWorldPosition - PreViewTranslation
```

普通相机视图中，通常有：

```text
PreViewTranslation = -CameraWorldPosition
```

因此，“加上 PreViewTranslation”通常就是“减去相机位置”。

看到 `LocalToTranslatedWorld`，可以理解为“局部坐标 → 平移后的世界坐标”；看到 `TranslatedWorldToClip`，就是“平移后的世界坐标 → 裁剪坐标”。**位置所在的空间必须与矩阵的输入空间匹配。**

## 4. 为什么这样能提高精度？

浮点数能保留的有效数字有限，数值越大，通常越难表示细小变化。

例如，要表达相机附近相差 1 厘米的两个点，使用 `100` 和 `101`，比使用两个巨大的世界坐标更容易保留这 1 厘米的差别。

UE5 的 **LWC（Large World Coordinates，大世界坐标）** 提供高精度坐标支持，它与 Translated World Space 可以配合使用：

```text
高精度世界坐标
    ↓ 以足够精度减去相机位置
较小的相对坐标
    ↓ 使用普通 float 继续渲染计算
```

**顺序很重要：先用足够精度算出相对位置，再降低精度。** 如果先把巨大的世界坐标转成低精度 float，丢失的细节不会因为随后减去相机位置而恢复。

## 5. 注意事项

- **世界方向保持不变。** 世界“向上”仍然沿 Z 轴，适合继续做世界方向相关的计算。
- **平移只影响位置。** 两点同时平移，彼此的距离和方向不变；法线、方向向量不需要加 `PreViewTranslation`。
- **与 View Space 相比，优势在于保留世界坐标轴。** 两者通常都使用较小的相对坐标，Translated World Space 并不天然具有更高精度。
- **材质中的 Camera Relative World Position 对应这一思路。** 在 World Position 节点的 `World Position Shader Offset` 中，可以选择相机相对位置；连接到其他位置输入时，要保证双方使用相同的参考空间。
