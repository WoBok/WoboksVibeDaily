---
title: "使用 UE 源码引擎打开现有工程"
date: "2026-07-13"
summary: "说明注册 UE 源码引擎、切换现有工程关联、重新生成并编译工程文件，最终打开工程的操作流程。"
category: "Unreal Engine"
tags:
  - "Unreal Engine"
  - "UE"
  - "源码引擎"
  - "Visual Studio"
  - "工程配置"
---

## 1. 注册源码引擎

进入源码引擎目录：

```text
...\Engine\Binaries\Win64
```

运行：

```text
UnrealVersionSelector-Win64-Shipping.exe
```

按提示确认注册。

注册完成后，右键 `.uproject` 时应能看到：

```text
Switch Unreal Engine version...
Generate Visual Studio project files
```

如果没有 `UnrealVersionSelector-Win64-Shipping.exe`，可以直接使用源码引擎的编辑器打开工程：

```bat
"...\Engine\Binaries\Win64\UnrealEditor.exe" "D:\Projects\MyProject\MyProject.uproject"
```

## 2. 切换工程关联的引擎

右键：

```text
MyProject.uproject
```

选择：

```text
Switch Unreal Engine version...
```

然后选择已经编译好的 UE 源码引擎。

## 3. 重新生成工程文件

再次右键 `.uproject`，选择：

```text
Generate Visual Studio project files
```

生成或更新：

```text
MyProject.sln
```

## 4. 编译工程

使用 Visual Studio 打开 `.sln`，选择：

```text
Configuration：Development Editor
Platform：Win64
```

然后编译工程项目。

## 5. 打开工程

编译成功后，双击：

```text
MyProject.uproject
```

也可以明确指定源码引擎打开：

```bat
"...\Engine\Binaries\Win64\UnrealEditor.exe" "D:\Projects\MyProject\MyProject.uproject"
```

## C++ 工程完整流程

```text
注册源码引擎
→ 切换 .uproject 的引擎版本
→ 生成 Visual Studio 工程文件
→ 编译 Development Editor | Win64
→ 打开工程
```

纯蓝图工程通常切换引擎后即可直接打开。

切换引擎前建议备份工程。
