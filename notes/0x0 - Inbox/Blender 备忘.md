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

H：隐藏选中物体  
Alt + H：显示所有隐藏物体  
Shift + H：隐藏未选中物体  

Tab：编辑模式
Ctrl + Tab：模式切换菜单  

Shift + C：Cursor 回到世界原点 + 显示整个场景  
Shift + S：吸附菜单

Z：渲染模式

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

## 操作

### 将选中物体渲染为线框模式
```text
选中模型 → Object Properties → Viewport Display → Display As → Wire
           ↑
           橙色方形图标🟧
```