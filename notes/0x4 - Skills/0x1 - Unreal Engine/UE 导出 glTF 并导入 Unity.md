---
title: "UE 导出 glTF 并导入 Unity"
date: "2026-07-13"
summary: "记录从 UE 导出 glTF 或 GLB、通过 glTFast 导入 Unity，并配置骨骼动画播放与运行时自动加载的完整流程。"
category: "Unreal Engine"
tags:
  - "Unreal Engine"
  - "Unity"
  - "glTF"
  - "glTFast"
  - "骨骼动画"
---

## 一、UE 中导出 glTF / GLB

### 1. 启用 glTF Exporter

打开：

```text
Edit → Plugins
```

搜索并启用：

```text
glTF Exporter
```

重启 UE。

### 2. 导出场景对象

在场景中选中需要导出的 Actor，然后执行：

```text
File → Export Selected
```

保存格式可以选择：

```text
.gltf
.glb
```

### 3. `.gltf` 和 `.glb` 的区别

`.gltf` 通常包含多个关联文件：

```text
Model.gltf
Model.bin
Textures/
```

导入或移动文件时，必须同时保留 `.bin` 和贴图文件，并保持原有相对路径。

`.glb` 通常将模型、材质和贴图封装在一个文件中，更方便传输和管理。

---

## 二、Unity 中导入 glTF / GLB

### 1. 安装 glTFast

打开：

```text
Window → Package Manager
```

点击左上角的 `+`，选择：

```text
Add package by name
```

输入：

```text
com.unity.cloud.gltfast
```

点击 `Add`。

### 2. 导入文件

将 UE 导出的文件复制到 Unity 项目的：

```text
Assets
```

如果使用 `.gltf`，需要一起复制：

```text
Model.gltf
Model.bin
Textures/
```

不要只复制 `.gltf` 文件。

### 3. 放入场景

导入完成后，将 glTF 生成的完整场景资产拖入：

```text
Hierarchy
```

---

## 三、动画文件的使用

### 1. UE 中设置并导出动画

选中场景中的 `Skeletal Mesh Actor`。

在 `SkeletalMeshComponent` 中设置：

```text
Animation Mode：Use Animation Asset
Animation：选择 Animation Sequence
```

导出 glTF 时开启：

```text
Export Vertex Skin Weights
Export Animation Sequences
```

其中：

* `Export Vertex Skin Weights`：导出蒙皮和骨骼权重。
* `Export Animation Sequences`：导出当前使用的动画序列。

### 2. 确认 Unity 中存在动画

在 Unity 的 Project 窗口中展开导入的 glTF 资产，确认其中存在：

```text
AnimationClip
```

如果没有 Animation Clip，检查 UE 导出时是否启用了动画和蒙皮权重选项。
### 1. 使用Animation Controller播放动画
#### 1. 创建 Animator Controller

在 Unity 的 Project 窗口中右键：

```text
Create → Animator Controller
```

打开 Controller，将 glTF 中的 `AnimationClip` 拖入 Animator 窗口。

将需要自动播放的状态设置为：

```text
Set as Layer Default State
```

默认状态会显示为橙色。

#### 2. 添加 Animator

将 `Animator` 添加到模型的**最外层根节点**：

```text
GLTF_Root  ← Animator 放这里
├── Armature
│   └── Bones
└── SkinnedMesh
```

不要将 Animator 添加到：

```text
SkinnedMesh 节点
单独的 Mesh 节点
某根骨骼
Armature 中间节点
```

Animator 所在节点是动画查找骨骼路径的起点。放错层级时，Animator 状态可能正在播放，但模型不会运动。

#### 3. 设置 Animator

在根节点的 Animator 组件中设置：

```text
Controller：创建的 Animator Controller
Avatar：可以留空
Apply Root Motion：按需要开启
```

glTF 原始骨架动画通常不需要 Avatar。只有使用 Unity Humanoid 动画重定向时，才需要有效的 Avatar。

### 2. 使用 GltfAsset 加载并自动播放（推荐）

#### 1. 将文件放入：

```text
Assets/StreamingAssets
```

例如：

```text
Assets/StreamingAssets/GLTF_Test/GLTF_Test01.gltf
```

使用 `.gltf` 时，还要保留对应的 `.bin` 和贴图文件；使用 `.glb` 时通常只有一个文件。

#### 2. 在场景中创建空物体，并添加：

```text
GltfAsset
```

#### 3. 设置组件：

```text
Url：GLTF_Test/GLTF_Test/GLTF_Test01.gltf
Streaming Asset：开启
Load On Startup：开启
Play Automatically：开启
```

加载 `.glb` 时，将 `Url` 改为对应的 `.glb` 路径。

`Url` 只填写相对于 `Assets/StreamingAssets` 的路径，不要包含：

```text
Assets/StreamingAssets
```

进入 Play Mode 后，模型会被加载，并自动播放第一段动画。




