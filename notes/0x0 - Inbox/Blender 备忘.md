---
title: "Blender 备忘"
date: "2026-08-11"
summary: "整理 Blender 基础视图、物体与模式操作快捷键，并说明 3D Cursor 与世界原点、物体原点的区别及定位用途。"
category: "Inbox"
tags:
  - "Blender"
  - "快捷键"
  - "3D Cursor"
  - "基础操作"
---

## Blender 基础快捷键

MMB：旋转视角  
Shift + MMB：平移视角  
Scroll MMB：缩放视角  

~：视图导航菜单  
Shift + Space：工具切换菜单  

Shift + A：新建物体  
Shift + D：复制物体  
X / Delete：删除物体  
Ctrl + A：应用变换

H：隐藏选中物体  
Alt + H：显示所有隐藏物体  
Shift + H：隐藏未选中物体  

Tab：编辑模式
Ctrl + Tab：模式切换菜单  

Shift + C：Cursor 回到世界原点 + 显示整个场景  
Shift + S：吸附菜单

Z：渲染模式

Shift + M：Link to Collection
Ctrl + J：Join

## 概念
### Cursor

Blender 中一个可自由移动的**空间定位点 / 临时锚点**。

**三个概念的区别：**
- **World Origin（世界原点）**：固定的 `(0,0,0)`，整个世界的中心 → **地图零点**
- **Object Origin（物体原点）**：属于物体，决定物体自身的变换参考 → **物体轴心**
- **3D Cursor（3D 游标）**：可自由移动的临时参考点 → **空间图钉**

**主要作用：**
- 决定新物体生成位置
- 作为旋转、缩放的临时中心
- 精确定位、吸附物体
- 辅助设置 Object Origin

**常用操作：**
- `Shift + 右键` → 放置 Cursor
- `Shift + S → Cursor to Selected` → Cursor 移到选中位置
- `Shift + S → Selection to Cursor` → 选中物移到 Cursor
- `Shift + S → Cursor to World Origin` → Cursor 回到 `(0,0,0)`

**3D Cursor = 三维空间中可自由移动的临时定位锚点。**

### Vertex 与 Face Corner 核心区别

- **Vertex（点）**：一个位置存一份数据，相邻面必然连续、自动插值。
- **Face Corner（面角）**：把这一份按面拆开——同一个点在每个相邻面上各存一份，法线、UV、颜色可以各不相同，因此能做出硬边界（硬边法线、UV 接缝、颜色硬色块）。

#### 术语对照

| Blender | Houdini | UE |
|---|---|---|
| Vertex（几何节点中显示为 Point） | Point | `FVertexID` |
| Face Corner（loop） | **Vertex** | `FVertexInstanceID` |
| Face | Primitive | `FPolygonID` |

#### 到引擎的转换

Corner 层是「允许不同」的上限；导入引擎后按**唯一属性组合**（法线 / UV / 切线 / 颜色）去重，实际不同才拆成渲染顶点。立方体 8 点 → 24 个渲染顶点，UE 编辑器显示的 Verts 即此值。

#### 选择建议

遮罩、渐变、随机着色 → Vertex，更轻。需要按面区分的硬色块，或匹配外部数据 → Face Corner。`Byte Color` 对应 UE 的 `FColor`（8 位），浮点 `Color` 导出会被压位。

Blender 内两域可随时互转：Object ▸ Convert Attribute。

### Blender 顶点色

3.2 起统一叫 **Color Attribute**，数量不限，靠名字区分。

#### 数据模型

- **域**:Face Corner(面角)可有硬边界 / Vertex(点)必然平滑
- **类型**:Byte Color(8bit，sRGB)存颜色 / Color float32(线性)存遮罩
- **两个激活标记**:选中项 = 画笔目标 + FBX 优先项；相机图标 = 材质默认值 + glTF 导出取的那个

#### 用法

- **添加**:Object Data Properties → Color Attributes → `+`，再进 Vertex Paint 模式刷
- **程序化**:几何节点 Store Named Attribute 写、Named Attribute 读，名字必须完全一致(大小写敏感，读不到就是 0)
- **查看**:视图着色 → Color: Attribute

#### 导出(FBX)

- **全部**导出，每个属性一层，层名 = 属性名
- 勾 `Prioritize Active Color` 把选中项提到第 0 层 —— 引擎只认第 0 层
- Vertex Colors 下拉:颜色选 sRGB，遮罩选 **Linear**(sRGB 会做编码，0.5 → 0.73)
- Apply Modifiers 默认开启 → 导出的是修改器算完的网格，属性可能已被改名/改域/插值

#### 跨软件

| 软件 | 能存几套 | 存在哪 |
|---|---|---|
| Blender | 不限 | Color Attributes，按名字 |
| Maya | 多套 | Color Sets，以 current set 为主 |
| UE / Unity | **只有一层** | 单个 8bit RGBA，导入只取第一层 |

- 多张遮罩打包进一个属性的 R/G/B/A，不要建多个属性
- 要精度改用 UV 通道:顶点色 8bit 只有 256 级会 banding，UV 是 float32(UE 最多 8 组)

## 操作

### 将选中物体渲染为线框模式
```text
选中模型 → Object Properties → Viewport Display → Display As → Wire
           ↑
           橙色方形图标🟧
```