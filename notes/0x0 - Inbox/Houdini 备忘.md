---
title: "Houdini 备忘"
date: "2026-09-28"
summary: "记录 Houdini 日常操作技巧与备忘，当前涵盖通过自定义版本参数为 VAT 导出路径添加版本文件夹的方法。"
category: "Inbox"
tags:
  - "Houdini"
  - "操作备忘"
  - "VAT"
  - "导出设置"
---

## 在 VAT 导出路径中添加版本文件夹

1. 选中 `vertex_animation_textures`，点击参数面板右上角的齿轮 → **Edit Parameter Interface**。

2. 在左侧 **By Type** 中选择 **Integer**，拖入右侧参数列表。设置 **Label** 为 `Export Version`、**Name** 为 `export_version`、默认值为 `1`、**Range** 为 `1–20`，然后点击 **Apply**。

3. 在 **Export → Export Path** 中填入：

   ```text
   $HIP/export/${HIPNAME}/v`ch("export_version")`
   ```

4. 导出前选择版本：滑杆为 `1` 时导出到 `v1` 文件夹，为 `2` 时导出到 `v2` 文件夹。确认版本后点击 **Render All**。