---
title: "Maya Node 基础"
date: "2026-08-24"
summary: "梳理 Maya 节点系统的基本概念、DAG 与 DG、常用编辑器、属性连接、求值机制、历史链与基础运算节点。"
category: "Maya"
tags:
  - "Maya"
  - "节点系统"
  - "Node Editor"
  - "DAG"
  - "DG"
  - "属性连接"
---

## 1. Maya 节点系统的基本定义

**Maya 场景本质上是一张数据计算网络：数据进入节点，节点进行处理，再把结果传给下一个节点。**

```text
输入 → 计算 → 输出 → 下一个节点的输入 → 最终结果
```

例如：

```text
控制器属性 → 数值放大 → 限制范围 → 关节旋转
```

## 2. 节点系统的核心组成

| 概念 | 通俗理解 | 示例 |
|---|---|---|
| Node | 执行某种功能的计算单元 | `transform`、`multiplyDivide` |
| Attribute | 节点上的数据或设置 | `translateX`、`input1X` |
| Input | 节点接收的数据 | 被驱动属性 |
| Output | 节点计算后的结果 | 驱动其他属性 |
| Connection | 从输出到输入的数据依赖 | `A.output → B.input` |

节点可以近似理解为：

```text
输出 = 节点功能（输入，参数）
```

例如：

```text
multiplyDivide.outputX = input1X × input2X
```

看到任何陌生节点，只问三个问题：

1. 它接收什么？
2. 它做了什么？
3. 它输出什么？

## 3. 场景对象的节点构成

以多边形球为例：

```text
pSphere1（Transform）
└── pSphereShape1（Shape）← polySphere1（Construction）
```

| 节点 | 负责什么 |
|---|---|
| Construction Node | 记录球怎样创建或修改 |
| Shape Node | 保存实际几何形状 |
| Transform Node | 保存位置、旋转、缩放和父子层级 |

找不到属性时，先确认它属于：

- Transform；
- Shape；
- 还是上游的 Construction History 节点。

## 4. DAG 层级与 DG 依赖关系

这是 Maya 节点系统最重要的区别之一。

### DAG：场景层级

回答：**谁在谁下面？**

```text
character_GRP
└── hand_CTRL
    └── weapon_GRP
```

父级移动，子级会继承运动。主要使用 Outliner 查看。

### DG：数据依赖

回答：**谁的数据影响谁？**

```text
hand_CTRL.fist → remapValue → finger_JNT.rotateZ
```

节点不需要是父子关系，也可以互相驱动。主要使用 Node Editor 查看。

```text
DAG = 父子层级
DG  = 数据连接
```

> Parent 与 Connect Attribute 不是一回事：Parent 改变层级，连接属性改变数据依赖。

## 5. Maya 常用 Editor 的职责划分

### Channel Box

**把当前对象及其相关节点中最常用、最适合直接操作的属性，集中展示出来的快捷属性面板。**

### Attribute Editor

**按照节点功能完整展示所选节点全部主要属性，用于查看和调整 Channel Box 中没有显示的详细设置。**

### Outliner

**以列表和树状层级展示场景中的对象与节点，用于选择、命名、整理以及管理 DAG 父子关系。**

### Node Editor

**把节点及其属性之间的依赖关系显示为可编辑网络，用于追踪数据来源、查看影响范围以及创建或断开连接。**

### Connection Editor

**把源节点与目标节点的属性并列展示，用于在两个节点之间准确选择并建立属性连接。**

### Graph Editor

**把关键帧动画显示为时间和值之间的曲线，用于调整关键帧、切线、速度、节奏和数值变化。**

### Hypershade

**把材质、纹理、工具节点、材质分配和渲染预览集中在同一工作区，用于建立和管理着色网络。**

### Hypergraph

**以图形方式展示场景的 DAG 层级或 DG 依赖关系，用于观察较大范围的对象结构与节点关系。**

快速选择：

```text
改数值 → Channel Box / Attribute Editor
改层级 → Outliner
改连接 → Node Editor / Connection Editor
改动画 → Graph Editor
改材质 → Hypershade
```

## 6. Node Editor 的基本操作

打开：

```text
Windows > Node Editor
```

### 标准查看流程

1. 在视口或 Outliner 选择目标对象。
2. 将所选对象加入 Node Editor。
3. 查看 Inputs，寻找谁在驱动它。
4. 查看 Outputs，确认它正在影响谁。
5. 沿着与问题有关的连线逐步展开。

不要一开始展开整个场景，否则很难阅读。

### 属性显示模式

| 快捷键 | 用途 |
|---|---|
| `1` | 只看节点结构 |
| `2` | 主要显示已连接属性，最适合读图 |
| `3` | 显示常用属性，适合接线 |
| `4` | 显示全部或自定义属性 |

### 创建节点

```text
光标放在工作区 → Tab → 输入节点类型 → Enter
```

创建后立即按功能命名，例如：

```text
arm_twistScale_MD
foot_roll_RMV
```

### 创建连接

```text
源节点的 Output → 目标节点的 Input
```

从源属性右侧端口拖到目标属性左侧端口。连接后检查两端的完整属性名。

### 三种删除要分清

| 操作 | 结果 |
|---|---|
| Remove from Graph | 只从当前图表隐藏 |
| Delete Connection | 删除连线，节点仍在 |
| Delete Node | 从场景中删除节点和功能 |

删除节点前先检查它的 Outputs，确认没有被其他对象共用。

## 7. 属性连接的基本规则

### 连接不是复制数值

```text
A.output → B.translateX
```

表示 B 的 Translate X 依赖 A 的输出。A 改变后，Maya 会重新计算 B。

### 一个输入通常只有一个直接来源

多个值需要先组合：

```text
A ─┐
   ├→ plusMinusAverage → Target
B ─┘
```

### 一个输出可以驱动多个目标

```text
CTRL.smile ─┬→ mouth_L
            ├→ mouth_R
            └→ cheek
```

修改共享上游会影响所有下游。

### 注意复合属性

```text
translate
├── translateX
├── translateY
└── translateZ
```

连接整个 `translate` 和只连接 `translateX` 不一样。接线前要确认需要一个轴还是三个轴。

### 数据类型必须匹配

| 类型 | 示例 |
|---|---|
| Scalar | 权重、单轴数值 |
| Vector | XYZ、RGB、方向 |
| Angle | 旋转 |
| Distance | 位移、长度 |
| Matrix | 完整空间变换 |
| Geometry | Mesh、Curve 数据 |
| Message | 只记录节点关系，不传数值 |

Maya 有时会自动插入 `unitConversion` 处理单位差异，不要把它当成无用节点随意删除。

## 8. 节点网络的求值机制

假设：

```text
A → B → C
```

A 变化后，Maya 会把相关下游标记为需要更新；当视口、动画或渲染需要 C 的结果时，再按依赖顺序计算。

现代 Maya 使用 Evaluation Manager 安排求值：

| 模式 | 用途 |
|---|---|
| Parallel | 正常工作，尽可能并行计算 |
| Serial | 串行运行，用于排查并行问题 |
| DG | 传统求值方式，用于兼容性对比 |

动画同样是节点网络：

```text
time1 → animCurve → object.rotateY
```

打关键帧通常是在创建或编辑 AnimCurve，让时间映射成属性值。

## 9. Construction History 的作用

Construction History 是 Shape 上游的计算链，不是文字操作记录。

```text
原始几何 → Extrude → Bevel → Deformer → 最终 Shape
```

Delete History 会保留当前结果，并删除可烘焙的上游过程节点。

注意：Skin、BlendShape 等变形器也可能位于历史链中。绑定后不要随便 Delete History；操作前先另存版本，必要时评估 `Delete Non-Deformer History`。

## 10. 常用节点运算类型

不需要先背大量节点，只要掌握这些运算模式：

| 需求 | 逻辑 | 常用节点 |
|---|---|---|
| 放大或缩小 | `输出 = 输入 × 倍数` | multiplyDivide |
| 增加偏移 | `输出 = 输入 + 偏移` | plusMinusAverage、addDoubleLinear |
| 正负反向 | `输出 = 输入 × -1` | multiplyDivide |
| 0～1 反向 | `输出 = 1 - 输入` | reverse |
| 限制范围 | 最小值 ≤ 输出 ≤ 最大值 | clamp |
| 映射范围 | 输入 A～B → 输出 C～D | remapValue、setRange |
| 条件判断 | If / Else | condition |
| 两个结果混合 | A 与 B 按权重混合 | blendColors、blendTwoAttr |
| 组合或拆分变换 | TRS ↔ Matrix | composeMatrix、decomposeMatrix |

常见网络可以统一理解为：

```text
Source → Process → Limit / Condition / Blend → Target
来源      处理           判断或混合              目标
```
