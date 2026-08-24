---
title: "Maya Hypershade 基础"
date: "2026-08-24"
summary: "梳理 Maya Hypershade 的界面分区、节点分类、材质与 Shading Group 关系，以及材质创建、分配、查询和自发光设置。"
category: "Maya"
tags:
  - "Maya"
  - "Hypershade"
  - "Shading Group"
  - "材质节点"
  - "Node Editor"
---

## 1. 一张图理解整个系统

```text
Texture / Utility（产生、处理数据）
                 ↓
Material（计算最终外观）
                 ↓
Shading Group（材质接口 + 使用对象名单）
                 ↓
          模型或模型的部分面
```

核心原则：

- **节点位置不重要，连接关系才决定结果。**
- Material 负责“显示什么”，Shading Group 负责“应用给谁”。
- Maya 真正分配给模型的是 Shading Group，不是孤立的 Material 节点。

## 2. Hypershade 各区域的逻辑

| 区域 | 作用 |
|---|---|
| Browser | 查看场景中**已经存在**的材质、贴图、灯光、SG 等节点 |
| Create | 创建新的渲染节点；相当于“节点类型目录” |
| Work Area | 查看、连接和整理材质网络 |
| Property Editor | 编辑当前节点的参数 |
| Material Viewer | 快速预览材质；最终效果仍以目标渲染器为准 |

最简单的理解：

```text
Create = 新建
Browser = 已有清单
Work Area = 连接关系
Property Editor = 修改参数
```

## 3. Browser 上方标签

| 标签 | 显示的已有节点 |
|---|---|
| Materials | 表面、体积和部分特殊材质节点 |
| Textures | File、Checker、Ramp、Noise 等纹理 |
| Utilities | Bump、混合、重映射、数学转换等工具 |
| Rendering | 特殊渲染流程节点 |
| Lights / Cameras | 场景灯光和相机 |
| Shading Groups | 材质分配中枢，名称通常以 `SG` 结尾 |

Browser 只是按类型查看场景节点，不是创建菜单，也不是磁盘素材库。

## 4. Create 分类

点击 Create 中的项目，会在场景里创建一个该类型的**节点实例**。

| 分类 | 用途 |
|---|---|
| Surface | 最终决定模型表面外观，如 Lambert、Blinn、Surface Shader |
| Volumetric | 雾、烟、云等体积外观 |
| Displacement | 改变模型表面高低和轮廓 |
| 2D Textures | 使用 UV 的图片或程序纹理 |
| 3D Textures | 存在于三维空间中的程序纹理 |
| Env Textures | 环境、背景和反射纹理 |
| Math / Utilities | 计算、混合、校正和转换数据 |
| Lights / Image Planes / Glow / Rendering | 灯光、参考图及特殊渲染功能 |
| Arnold | Arnold 提供的 Shader、Texture、Light 和 Utility 节点 |

`Maya`、`Arnold` 表示节点来自哪套渲染体系；`Surface`、`Texture`、`Utility` 表示节点用途。

## 5. Material 与 Shading Group

创建一个 Blinn，Maya 通常同时生成：

```text
blinn1                       材质节点
blinn1SG                     Shading Group
blinn1.outColor ───────────→ blinn1SG.surfaceShader
```

是否自动生成 SG 由下面的选项控制：

```text
Create > Create Options > Include Shading Group with Materials
```

Shading Group 主要有三个材质接口：

```text
Surface Shader        表面外观
Volume Shader         体积外观
Displacement Shader   表面置换
```

数量关系：

- 一个 SG 可以分配给多个模型或多个模型面。
- 一个模型的不同面可以属于不同 SG。
- 多个 SG 也可以共享同一个 Material。
- 修改共享材质，会影响所有使用它的对象。

## 6. 材质的核心操作

### 创建并立即应用

```text
选中模型
→ 右键 Assign New Material
→ 选择 Surface 材质
```

Maya 会自动完成“创建 Material → 创建 SG → 连接 → 分配”。

### 在 Hypershade 中创建后再应用

```text
Create > Surface 创建材质
→ 选中模型或模型面
→ 右键 Browser 中的材质
→ Assign Material to Selection
```

也可以用中键把材质球拖到模型上。

### 编辑与查询

| 需求 | 操作 |
|---|---|
| 修改材质 | 在 Materials 中选择材质，在 Property Editor 编辑 |
| 查看完整网络 | 右键材质 → `Graph Network` |
| 查看所选模型材质 | `Graph Materials on Selected Objects` |
| 查材质用于哪些模型 | 右键材质 → `Select Objects with Material` |
| 更换材质 | 给对象重新执行 `Assign Material to Selection` |
| 恢复默认材质 | 重新分配 `lambert1` |

## 7. 创建自发光材质

```text
Create > Maya > Surface > Lambert
→ 将 Color 设置为纯黑色
→ 将颜色或贴图连接到 Incandescence
→ Assign Material to Selection
```

使用 Lambert 制作这种自发光材质，可以避免导出 FBX 时出现材质类型不受支持的提示。

## 8. Hypershade 与独立 Node Editor

| 编辑器 | 适合工作 |
|---|---|
| Hypershade Work Area | 材质、贴图、Utility、SG 等着色网络 |
| `Windows > Node Editor` | Transform、Shape、建模历史、变形器和完整依赖关系 |

在 Hypershade Work Area 空白处右键，通过 `Show` 选择需要显示的节点类型。这里可以控制 Transform、Shape、Shading Group 和材质节点等内容的显示。

在独立 Node Editor 查看所选模型材质：

```text
选择模型
→ Node Editor 空白处右键
→ Graph Materials on Viewport Selection
```
