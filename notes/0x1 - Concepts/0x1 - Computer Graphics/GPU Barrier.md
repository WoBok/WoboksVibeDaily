---
title: "GPU Barrier"
date: "2026-08-29"
summary: "解析 GPU Barrier 的执行同步、缓存一致性与资源状态转换，并说明 RDG 如何自动推导和优化屏障以兼顾正确性与性能。"
category: "Computer Graphics"
tags:
  - "GPU"
  - "Barrier"
  - "资源同步"
  - "RDG"
---

**Barrier（屏障）** 在图形渲染中，本质上是 CPU 发给 GPU 的一条“交通管制指令”。

在现代 GPU（DX12 / Vulkan / Metal）中，硬件为了极致的性能，默认是高度并行、甚至乱序执行指令的。如果没有约束，后一个任务可能会在“前一个任务还没写完”或者“显存数据还没同步好”时就急着去读取，从而引发**画面撕裂、花屏或崩溃（竞态冲突）**。

Barrier 就是在两个渲染操作之间立起的一道“安全闸门”。

## 1. Barrier 具体在做什么？

一个完整的 Barrier 操作通常同时处理三件事：

<svg xmlns="http://www.w3.org/2000/svg" width="640" viewBox="0 0 840 470" role="img" aria-labelledby="barrier-title barrier-desc" style="display:block;max-width:100%;height:auto;margin:20px auto;">
  <title id="barrier-title">GPU Barrier 安全闸门示意图</title>
  <desc id="barrier-desc">Pass A 写入贴图后，Barrier 依次处理执行同步、缓存刷新和状态转换，随后 Pass B 才读取贴图。</desc>
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="#000"/>
    </marker>
  </defs>
  <g fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="270" y="10" width="300" height="52" rx="12"/>
    <path d="M420 62 V98" marker-end="url(#arrowhead)"/>
    <rect x="70" y="110" width="700" height="230" rx="15"/>
    <path d="M70 164 H770"/>
    <path d="M110 224 H730" stroke-width="1.5"/>
    <path d="M110 282 H730" stroke-width="1.5"/>
    <circle cx="122" cy="194" r="15"/>
    <circle cx="122" cy="253" r="15"/>
    <circle cx="122" cy="311" r="15"/>
    <path d="M420 340 V388" marker-end="url(#arrowhead)"/>
    <rect x="270" y="400" width="300" height="52" rx="12"/>
  </g>
  <g fill="#000" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif" dominant-baseline="central" style="line-height:normal;">
    <text x="420" y="36" font-size="19" font-weight="700" text-anchor="middle">Pass A：写入贴图</text>
    <text x="420" y="137" font-size="23" font-weight="700" letter-spacing="0.5" text-anchor="middle">BARRIER（安全闸门）</text>
    <text x="122" y="194" font-size="17" font-weight="700" text-anchor="middle">1</text>
    <text x="122" y="253" font-size="17" font-weight="700" text-anchor="middle">2</text>
    <text x="122" y="311" font-size="17" font-weight="700" text-anchor="middle">3</text>
    <text x="420" y="426" font-size="19" font-weight="700" text-anchor="middle">Pass B：读取贴图（采样）</text>
  </g>
  <g fill="#000" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif" dominant-baseline="central" text-anchor="start" style="line-height:normal;">
    <text x="155" y="194" font-size="17" font-weight="700">执行同步</text>
    <text x="285" y="194" font-size="16">Execution Sync</text>
    <text x="500" y="194" font-size="16">等 Pass A 完全写完</text>
    <text x="155" y="253" font-size="17" font-weight="700">缓存刷新</text>
    <text x="285" y="253" font-size="16">Memory Flush</text>
    <text x="500" y="253" font-size="16">把 L1 / L2 缓存写回显存</text>
    <text x="155" y="311" font-size="17" font-weight="700">状态转换</text>
    <text x="285" y="311" font-size="16">Layout Transition</text>
    <text x="500" y="311" font-size="16">切换为只读贴图格式</text>
  </g>
</svg>

- **执行同步（Execution Barrier）**：约束时间先后顺序。“必须等 Pass A 的像素着色器全部写完，Pass B 才能开始读”。

- **内存同步（Memory Barrier）**：处理 GPU 缓存一致性。GPU 各计算单元有自己的 L1/L2 缓存，Pass A 写完的数据可能还在缓存里，Barrier 会强制把脏数据写回全局显存，并使 Pass B 的读缓存失效以读取最新数据。

- **状态/布局转换（State / Layout Transition）**：转换资源存储结构。一张贴图作为“渲染目标（RenderTarget）”和作为“着色器读取资源（ShaderResource）”时，GPU 内部的压缩格式、解包方式甚至排列（Tiling）可能完全不同，Barrier 会通知硬件切换访问模式。

## 2. 为什么在 RDG 中很少手动写 Barrier？

在传统的 DX12/Vulkan 开发中，手动插入 Barrier 是最痛苦且极易出错的工作：

- **插少了**：出现竞态冒险（Race Hazard），画面闪烁或报错。

- **插多了 / 插早了**：导致 GPU 流水线频繁停顿（Pipeline Bubble / Stall），严重浪费性能。

**RDG 的巨大价值之一就是“自动且最优地管理 Barrier”**：

1. **自动推导**：RDG 拥有整帧的依赖图，它清楚地知道 `Texture A` 在第 3 步被写入（RenderTarget），在第 7 步被读取（SRV），它会自动在这两步之间计算并插入最精确的状态转换。

2. **分离屏障（Split Barriers 优化）**：RDG 可以在 Pass 3 刚结束时发送 `BeginTransition`，然后让 GPU 去做其他不相干的任务，直到 Pass 7 开始前才发送 `EndTransition`。这样状态转换的开销就被其他渲染任务完全掩盖（Hide Latency）了。

---

Barrier 就是 GPU 任务之间的“交通红绿灯与转接头”，负责**等写完、刷缓存、转格式**，确保前后渲染步骤安全交接且数据正确。
