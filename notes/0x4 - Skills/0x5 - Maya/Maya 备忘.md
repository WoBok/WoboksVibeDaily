---
title: "Maya 备忘"
date: "2026-08-24"
summary: "汇总 Maya 日常使用中遇到的问题、操作技巧与解决方法，涵盖常用工作流。"
category: "Maya"
tags:
  - "Maya"
  - "Lambert"
  - "自发光材质"
  - "Node Editor"
  - "FBX"
---

### 自发光材质
1. 在 Hypershade 中创建 Lambert 材质
2. 将 Color 设置为纯黑色
3. 将颜色或贴图连接到 Incandescence
创建 Lambert 材质可以避免导出 FBX 时提示材质不支持

### Node Editor 增量添加Node
在 Node Editor 中 Opitions 选项中勾选 Additive Graphing Mode  
后续使用 Input and output connections 添加上下游 Nodes 时，不会丢弃原有的 Nodes

可以压缩成下面这套心智模型：

> Maya 视口 = **几何显示 × 材质/贴图 × 灯光来源 × 附加效果**

### Maya 渲染窗口渲染模式

快捷键：

- `4`：Wireframe，只看线框/拓扑
- `5`：Shaded，看实体形体，不显示贴图
- `6`：Shaded + Texture，看实体 + 贴图
- `7`：Use All Lights，改用场景里的灯光

常用开关：

- `Default Lighting`：Maya 给视口临时打一个默认灯，方便看模型
- `Use All Lights`：使用场景真实灯光
- `Use Selected Lights`：只看选中灯的贡献
- `Flat Lighting`：均匀照亮，适合看纯颜色/贴图
- `No Lights`：关闭正常灯光计算
- `Default Material`：临时忽略真实材质，用统一默认材质看形体
- `Wireframe on Shaded`：实体上叠加线框
- `Shadows`：是否显示视口阴影
- `Two Sided Lighting`：背面是否也参与照明
- `SSAO`：视口环境遮蔽，让缝隙和接触区域更暗、更有体积感
- `Viewport 2.0`：整个视口实时渲染系统，负责把这些效果最终画出来
