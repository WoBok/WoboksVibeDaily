# Compute Shader 在 GPU 上的调度 —— 以 NVIDIA Blackwell 为参照

> 参考资料：
> - [NVIDIA RTX Blackwell GPU Architecture Whitepaper v1.1](https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf)（本文所有 Blackwell 硬件数字来源）
> - [NVIDIA Blackwell Tuning Guide](https://docs.nvidia.com/cuda/blackwell-tuning-guide/index.html)（Compute Capability 12.0 的占用率上限）
> - [CUDA C++ Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)
>
> 说明：白皮书是**图形向**文档，不写 warp 槽位这类数字；占用率上限来自 CUDA Tuning Guide（GB20x 消费级 Blackwell = Compute Capability 12.0）。两者我在文中分别标注了出处。

---

## 〇、先给结论：你的理解对了多少

| # | 你的表述 | 判定 | 说明 |
|---|---------|------|------|
| 1 | `Dispatch(64,64,1)` → 4096 个 Thread Group | ✅ 正确 | 64×64×1 = 4096 |
| 2 | `numthreads(8,8,1)` → 每组 64 个线程 | ✅ 正确 | 8×8×1 = 64 |
| 3 | Thread Group 被 GPU 不断分配到空闲的 SM 上 | ✅ 方向正确 | 机制叫 **GigaThread Engine / Compute Work Distributor**，见 §3 |
| 4 | 一个 Group 被拆成多个 warp，64 线程 = 2 warp，256 线程 = 8 warp | ✅ 正确 | 但准确公式是 **ceil(N/32)** 不是整除，见 §4.2 |
| 5 | "这些 warp 会被送到空闲的 SMSP 中处理" | ⚠️ **需修正** | **同一个 Group 的所有 warp 必须落在同一个 SM 内**，只能在这个 SM 的 4 个 SMSP 之间分配，不能跨 SM。见 §4.3 |
| 6 | "感觉一个 SMSP 处理一个 warp" 的直觉 | ⚠️ **需修正** | SMSP 每周期**发射**(issue) 1 个 warp 的指令，但同时**驻留**(resident) 最多 12 个 warp。**发射 ≠ 驻留**，这正是 GPU 隐藏延迟的核心。见 §5 |
| 7 | SM 上可以驻留多个线程组 | ✅ 正确 | 这是你最重要的那个自我纠正 |
| 8 | "硬件按空闲槽位轮转分配" | ⚠️ 不够精确 | 不是随意轮转，而是**四类资源同时满足才放得下，且整组 all-or-nothing**。见 §6 |
| 9 | 拼写 `wrap` | ❌ 错字 | 是 **warp**（织布机的"经纱"，一排并行的线），不是 wrap（包裹） |

总体：**你的骨架是对的**，需要补的是三处——(a) Group 与 SM 的绑定关系，(b) 驻留 vs 发射的区别，(c) 什么资源在真正限制并行度。下面逐层展开。

---

## 一、`Dispatch()` 和 `numthreads()` 到底在描述什么

### 1.1 两个数字构成一个三层坐标系

```
Dispatch(Gx, Gy, Gz)              ← CPU 侧，运行时决定，描述"有多少个组"
[numthreads(Tx, Ty, Tz)]          ← Shader 侧，编译期常量，描述"每组多少线程"

总线程数 = (Gx*Gy*Gz) * (Tx*Ty*Tz)
```

以你的例子：`Dispatch(64,64,1)` + `numthreads(8,8,1)`

```
4096 个 Group  ×  64 个 Thread/Group  =  262,144 个线程
```

这 262,144 个线程会各自执行一遍你的 `CSMain`，唯一的区别是**它们拿到的系统值不同**。

### 1.2 三维只是给你用的"索引糖"

**关键认知：GPU 硬件层面没有三维概念。** 三个维度纯粹是为了让你写 2D 图像 / 3D 体素时索引方便。硬件内部会把三维线性化：

```hlsl
// 组内线程的线性序号（HLSL 直接提供）
SV_GroupIndex = GroupThreadID.z * Tx * Ty
              + GroupThreadID.y * Tx
              + GroupThreadID.x;
```

注意 **x 是变化最快的维度**。这个顺序不是随便定的，它直接决定了哪些线程被打包进同一个 warp（§4.2），进而决定你的内存访问模式好不好。**这是三维语义唯一真正影响性能的地方。**

### 1.3 HLSL 里的五个系统值

| 语义 | 类型 | 含义 | 范围 |
|------|------|------|------|
| `SV_GroupID` | uint3 | 当前是第几个组 | `[0, Gx) × [0, Gy) × [0, Gz)` |
| `SV_GroupThreadID` | uint3 | 组内的三维坐标 | `[0, Tx) × [0, Ty) × [0, Tz)` |
| `SV_GroupIndex` | uint | 组内线性序号 | `[0, Tx*Ty*Tz)` |
| `SV_DispatchThreadID` | uint3 | 全局三维坐标 | `[0, Gx*Tx) × ...` |

它们的关系是纯粹的算术恒等式：

```hlsl
SV_DispatchThreadID = SV_GroupID * uint3(Tx,Ty,Tz) + SV_GroupThreadID;
```

`Dispatch(64,64,1)` + `numthreads(8,8,1)` 得到的全局网格是 **512 × 512**，正好覆盖一张 512×512 的图，每个线程处理一个像素：

```hlsl
[numthreads(8,8,1)]
void CSMain(uint3 id : SV_DispatchThreadID)
{
    Result[id.xy] = float4(id.xy / 512.0, 0, 1);   // id.xy ∈ [0,512)²
}
```

### 1.4 硬性上限（D3D11 / D3D12）

| 项目 | 上限 |
|------|------|
| `Dispatch` 每个维度 | **65535** |
| `numthreads` X, Y | ≤ 1024 |
| `numthreads` Z | ≤ **64** |
| `Tx * Ty * Tz` 总量 | ≤ **1024** |
| `groupshared` 每组总量 | ≤ **32 KB**（D3D 的限制，比硬件的 99KB 更严） |

> Vulkan/GL 的对应上限是 `maxComputeWorkGroupCount`（NV 上通常远大于 65535）、`maxComputeWorkGroupInvocations` = 1024、`maxComputeSharedMemorySize` = 48KB。跨 API 移植时注意 groupshared 那一栏。

**65535 这个上限会真实咬到你。** 处理 4096×4096 的图、`numthreads(8,8,1)` 时需要 512×512 组，没问题；但如果你写成一维 `Dispatch(N,1,1)` 处理 1000 万个粒子、`numthreads(64,1,1)`，就需要 156250 组 —— 超了。解法是折成二维：

```cpp
uint total  = (particleCount + 63) / 64;
uint dimX   = min(total, 65535u);
uint dimY   = (total + dimX - 1) / dimX;
Dispatch(dimX, dimY, 1);
```

```hlsl
[numthreads(64,1,1)]
void CSMain(uint3 gid : SV_GroupID, uint gi : SV_GroupIndex)
{
    uint index = (gid.y * DimX + gid.x) * 64 + gi;
    if (index >= ParticleCount) return;   // 尾部保护，必须有
    ...
}
```

### 1.5 向上取整派发 + 边界检查（必备套路）

组数必须是整数，所以不能整除的尺寸一定要向上取整，然后在 shader 里丢弃越界线程：

```cpp
// CPU
Dispatch((Width + 7) / 8, (Height + 7) / 8, 1);
```

```hlsl
// GPU
[numthreads(8,8,1)]
void CSMain(uint3 id : SV_DispatchThreadID)
{
    if (id.x >= Width || id.y >= Height) return;   // 漏了它 = 越界写 / 数据损坏
    ...
}
```

⚠️ **这个 `return` 不会让硬件少跑活。** 那些线程仍然占着 warp 的 lane、占着寄存器，只是被谓词屏蔽掉（predication）不写结果而已。所以让尺寸对齐到 `numthreads` 的倍数是有真实收益的。

### 1.6 为什么 `numthreads` 必须是编译期常量

因为编译器要在编译时就完成三件事：

1. **寄存器分配** —— 决定每线程用多少寄存器，这直接决定一个 SM 能塞下几个组；
2. **`groupshared` 布局** —— LDS 的静态大小必须在启动前就知道；
3. **warp 打包与屏障代码生成** —— `GroupMemoryBarrierWithGroupSync()` 的实现方式依赖组内 warp 数量。

驱动会把 `numthreads` 编进 shader 二进制，`Dispatch` 时硬件从 shader 元数据里读它，CPU 端**不能**改。这就是为什么 `Dispatch` 是运行时参数、`numthreads` 是编译期常量——两者所处的抽象层不同。

### 1.7 `DispatchIndirect`

组数如果依赖于 GPU 上一 pass 的结果（比如剔除后剩多少物体），不要回读到 CPU（会打断流水线，代价极高）。用间接派发，参数直接从 GPU buffer 里读：

```cpp
// buffer 内容就是 3 个 uint: {ThreadGroupCountX, Y, Z}
DispatchIndirect(argBuffer, offset);
```

上一个 compute pass 直接用原子操作往这个 buffer 里写组数即可，CPU 全程不参与。

---

## 二、Blackwell 硬件层级（白皮书原始数据）

```
GPU (GB202 满配)
├── GigaThread Engine + Compute Work Distributor   ← Thread Group 的分发者
├── AI Management Processor (AMP, RISC-V)          ← Context 级调度，不是 warp 级
├── 128 MB L2 Cache（RTX 5090 为 96 MB）
└── 12 × GPC (Graphics Processing Cluster)
     ├── 1 × Raster Engine
     ├── 2 × ROP 分区（每分区 8 个 ROP，共 16）
     └── 8 × TPC (Texture Processing Cluster)
          ├── 1 × PolyMorph Engine
          └── 2 × SM  ← 我们关心的单位
```

**每个 SM 内部**（白皮书 §SM Architecture 明确列出）：

| 资源 | 数量 |
|------|------|
| CUDA Cores | **128** |
| Tensor Cores（第 5 代） | **4** |
| RT Core（第 4 代） | 1 |
| Texture Units | 4 |
| **Register File** | **256 KB**（= 65,536 个 32-bit 寄存器） |
| **L1 Data Cache / Shared Memory**（统一，可配置划分） | **128 KB** |
| FP64 Cores | 2（吞吐仅 FP32 的 1/64，仅为正确性存在） |

**SM 被划分为 4 个 Processing Block / SM Sub-Partition (SMSP)**，每个 SMSP 含 32 个 CUDA Core、1 个 Tensor Core、1 个 warp scheduler + dispatch unit、以及 1/4 的寄存器堆（64 KB）。白皮书没有直接写"4 个分区"这句话，但"每 SM 4 个 Tensor Core"和 Figure 5/6 的框图就是这个结构，且与 Volta 以来历代一致。

**规模感**（满配 GB202）：192 SM × 128 = **24,576 CUDA Cores**、192 RT Core、768 Tensor Core。RTX 5090 是裁剪版：**170 SM**（白皮书提到 5090 有 680 个 texture unit = 170×4）→ 21,760 CUDA Cores、96 MB L2、512-bit GDDR7 @ 28 Gbps = 1.792 TB/s。

### 2.1 Blackwell 相对 Ada 对 Compute Shader 最重要的改动

白皮书 v1.1 的原文要点：

> "the number of possible integer operations in Blackwell GB20x GPUs are doubled for many integer instructions compared to Ada, by fully unifying the INT32 cores with the FP32 cores... However, the unified cores can only operate as either FP32 or INT32 cores in any given clock cycle."

翻译成对你有用的话：

- **Ada**：每 SM 是 64 个 FP32 专用核 + 64 个 FP32/INT32 双能核。整数指令峰值 = 64/clk。
- **Blackwell**：128 个核**全部**可做 FP32 或 INT32（每周期二选一）。整数指令峰值 = 128/clk，**翻倍**。

这对 compute shader 是实打实的收益，因为整数运算在 GPGPU 里无处不在：地址计算、哈希、位运算、GPU 排序/基数排序、Morton 码、bitmask 剔除、原子计数索引。但要注意白皮书的保留意见——**不是所有整数指令都能拿到 2×**（乘法、移位等各有各的吞吐）。

另外两点值得知道：

- **第 5 代 Tensor Core + Cooperative Vectors API**：现在可以从 compute / pixel shader 里直接调用 Tensor Core 做小矩阵乘（神经着色）。这是 Blackwell 时代 compute shader 的新用法。
- **AMP（AI Management Processor）**：白皮书描述它是"a fully programmable context scheduler... implemented using a dedicated RISC-V processor located at the front of the GPU pipeline"，配合 Windows HAGS 工作。⚠️ **不要把它和 warp 调度混淆**——AMP 调度的是**整个 GPU context**（不同应用、不同队列之间谁先跑），粒度是毫秒级；warp 调度是 SMSP 内部的硬件逻辑，粒度是单个时钟周期。两者差 6 个数量级，属于完全不同的层次。

---

## 三、从 `Dispatch` 到 SM：谁在分发

调用 `Dispatch(64,64,1)` 之后发生的事：

```
CPU: Dispatch(64,64,1) 写进 Command List
      ↓  提交到 Command Queue
GPU 前端: Command Processor 解析
      ↓
GigaThread Engine / Compute Work Distributor (CWD)
      ↓  按线性顺序取出一个个 Thread Group
      ↓  查询：哪个 SM 还塞得下一整个 Group？
      ↓
分配到某个 SM  ←── 整组一次性放置，all-or-nothing
      ↓
SM 内部：Group 拆成 warp，warp 分派到 4 个 SMSP
      ↓
SMSP 的 warp scheduler 每周期挑一个 ready warp 发射指令
```

### 三条你必须内化的规则

**规则 1：Group 的调度顺序完全没有保证。**
不要写任何依赖"Group 5 在 Group 3 之后执行"的代码。CWD 大致按线性顺序取，但完成顺序由各 SM 的进度决定，是乱序的。

**规则 2：Group 之间不能同步。**
没有 device-wide barrier。想让 A 的所有输出被 B 读到，只能拆成两次 `Dispatch`，中间加 UAV barrier。

⚠️ **不要试图用自旋锁在 compute shader 里做跨组同步——会死锁。** 因为 Group 一旦驻留就不会被抢占（no preemption at block level），如果 Group 0 在自旋等 Group 4095，而 Group 4095 因为 SM 满了根本还没被分配，就永远等下去了。

**规则 3：驻留后不迁移。**
一个 Group 被放到某个 SM 上，就在那儿待到全组退出，中途不会搬家、不会被换出。所以它的寄存器和 groupshared 是**整段独占**的。

### 一个 SM 上可以同时住着什么

- 来自**同一个 Dispatch** 的多个 Group ✅（最常见）
- 来自**不同 Dispatch** 的 Group ✅（如果两个 dispatch 之间没有 barrier）
- 来自**不同队列**的工作 ✅（async compute：graphics queue 的像素着色和 compute queue 的 Group 共享同一个 SM，这正是异步计算能填满 GPU 空隙的原理）

---

## 四、Group → warp：你需要修正的地方

### 4.1 warp 是什么

**warp = 32 个线程锁步执行同一条指令**（SIMT）。这是 NVIDIA 硬件的最小调度单位。HLSL 里叫 **wave**，用 `WaveGetLaneCount()` 查询，NVIDIA 上恒为 32（AMD 上是 32 或 64，Intel 是 8/16/32 —— 跨厂商时别硬编码）。

warp 里的 32 条 lane **共享一个程序计数器**（Volta 之后每线程有独立 PC，但发射仍是 warp 粒度）。这是理解一切 GPU 性能问题的起点。

### 4.2 拆分规则：ceil，不是整除

```
warp 数 = ceil(Tx * Ty * Tz / 32)
```

按 `SV_GroupIndex` 顺序连续切：warp 0 拿 GroupIndex 0–31，warp 1 拿 32–63，依此类推。

| numthreads | 线程数 | warp 数 | 浪费的 lane |
|-----------|-------|--------|-----------|
| `(8,8,1)` | 64 | **2** | 0 ✅ |
| `(16,16,1)` | 256 | **8** | 0 ✅ |
| `(32,1,1)` | 32 | 1 | 0 ✅ |
| `(64,1,1)` | 64 | 2 | 0 ✅ |
| `(10,10,1)` | 100 | **4** | **28 条 lane 空转** ❌ |
| `(1,1,1)` | 1 | **1** | **31 条 lane 空转（97% 浪费）** ❌❌ |
| `(8,8,2)` | 128 | 4 | 0 ✅ |

**你前两个例子恰好整除，所以没暴露这个坑。** 铁律：**`Tx*Ty*Tz` 必须是 32 的倍数**，否则最后一个 warp 的空闲 lane 依然占满寄存器、占满 warp 槽位、跟着走完整个指令流，纯粹是烧电。`numthreads(1,1,1)` 是初学者最常见的灾难写法——你只用到了 GPU 的 1/32。

### 4.3 ⭐ 你理解里需要修正的核心点

> 你的原话："这些 warp 会被送到空闲的 SMSP 中进行处理"

**一个 Thread Group 的所有 warp 必须驻留在同一个 SM 上，只能在这个 SM 内部的 4 个 SMSP 之间分配。** 绝不跨 SM。

**为什么硬件必须这么设计**——两条来自编程模型的硬约束：

1. **`groupshared` 内存是 SM 本地的物理 SRAM**（那 128 KB 的一部分）。同组线程要互相读写这块内存，就必须共用同一块物理 SRAM。SM 之间没有共享 SRAM，只能通过 L2 通信——那就不是 groupshared 了。
2. **`GroupMemoryBarrierWithGroupSync()` 是 SM 内的硬件屏障**。SM 内部有专门的 barrier 计数器电路，等待全组 warp 到齐。跨 SM 同步只能走 L2 原子操作，慢好几个数量级，硬件不会为此付出代价。

所以正确的图景是：

```
Group #17 (numthreads(16,16,1) = 8 warps)
        ↓ CWD 决定放到 SM #42
   ┌────────────────── SM #42 ──────────────────┐
   │  SMSP0    SMSP1    SMSP2    SMSP3          │
   │  warp0    warp1    warp2    warp3          │  ← 组内 8 个 warp
   │  warp4    warp5    warp6    warp7          │     轮转分配到 4 个分区
   │                                            │
   │  共享：128KB L1/Shared、Group #17 的        │
   │        groupshared 区、barrier 硬件         │
   └────────────────────────────────────────────┘
```

warp 到 SMSP 的分配通常是按 warp 序号轮转（`warp_id % 4`），一旦定下**终身不变**——warp 不会在 SMSP 之间迁移。（轮转规则是实现细节，架构上不保证，但历代都是这样。）

### 4.4 分支发散（warp 存在带来的最大代价）

因为一个 warp 共用发射逻辑，`if/else` 内部走向不同的线程只能**串行**执行两条路径，另一边被谓词屏蔽：

```hlsl
if (id.x % 2 == 0)  A();   // 半个 warp 执行，另一半空转
else                B();   // 反过来，再执行一遍
// 总耗时 = A + B，不是 max(A, B)
```

**判断标准不是"有没有分支"，而是"分支边界是否对齐 32 线程"：**

```hlsl
// ❌ 最坏：warp 内每条 lane 都不同 → 32 倍代价
if (id.x % 2 == 0) { ... }

// ✅ 无代价：整个 warp 走同一边，硬件直接跳过另一分支
if (GroupIndex < 32) { ... }

// ✅ 无代价：uniform 分支（所有线程条件相同）
if (EnableFeature) { ... }
```

这里正好解释了 §1.2 说的"x 变化最快"为什么重要：如果你的分支条件跟 `id.y` 相关，用 `numthreads(8,8,1)` 时 warp 0 覆盖的是 y ∈ [0,4)（8×8 布局下前 32 个线程 = 4 行），发散；用 `numthreads(32,1,1)` 则 warp 完全落在同一行，不发散。**`numthreads` 的形状直接决定了 warp 覆盖数据的形状。**

---

## 五、驻留 ≠ 发射：SMSP 到底在干什么

> 你的原话："给人的感觉是一个 SM 中包含 4 个 SMSP，一个 SMSP 处理一个 warp"

这个直觉抓住了"发射"，漏掉了"驻留"。这是整个 GPU 设计哲学的关键。

### 每个 SMSP 每时钟周期：

- **驻留** 最多 **12 个 warp**（Compute Capability 12.0 的 48 warps/SM ÷ 4 个分区）
- 从这 12 个里**挑 1 个 ready 的**，发射 1 条指令
- 剩下 11 个在等：等内存返回、等 barrier、等前序指令的结果

**上下文切换零开销。** 因为每个驻留 warp 的寄存器**始终物理占用**寄存器堆里的一块，切换 warp 只是换个索引，不需要保存/恢复任何东西——这跟 CPU 线程切换（要把寄存器压栈、刷 TLB）是完全不同的机制。GPU 用**海量寄存器**换来了**免费的上下文切换**。

### 这就是 GPU 掩盖延迟的方式

一次 VRAM 访问要 400–800 个时钟周期。CPU 的应对是巨大的缓存 + 乱序执行 + 分支预测。GPU 的应对简单粗暴：

```
cycle 0:    warp0 发起 load  →  停下等 600 cycle
cycle 1:    warp1 发射一条 ALU 指令
cycle 2:    warp2 发射
cycle 3:    warp3 发射
...
cycle 600:  warp0 的数据回来了，重新变成 ready
```

只要驻留的 warp 足够多，**内存延迟被完全填满，SMSP 一刻不闲**。所以：

> **占用率（Occupancy）= 实际驻留 warp 数 / 硬件最大驻留 warp 数**

它衡量的是"你给了硬件多少可切换的备胎"。回答你的那个疑问：

> "一个线程组 `numthreads(8,8,1)` 只有 2 个 warp，只会占用两个 SMSP"

**不会。** 这 2 个 warp 确实只占 2 个 SMSP 的各 1 个槽位，但那个 SM 上会同时驻留 **24 个这样的 Group**（算法见 §6），凑够 48 个 warp，4 个 SMSP 各拿 12 个，全部填满。**一个 Group 从来不是 SM 的工作单位，它只是资源分配的单位。**

---

## 六、真正限制并行度的四类资源

> 你的原话："硬件按照空闲槽位轮转分配"

方向对，但"槽位"不止一种。CWD 要把一个 Group 放上某个 SM，必须**同时**满足四个条件（差一个都放不下，而且是整组 all-or-nothing）：

### Compute Capability 12.0（GB20x Blackwell）的硬上限

| 限制项 | 每 SM 上限 | 出处 |
|--------|-----------|------|
| 最大驻留 **warp** 数 | **48**（= 1536 线程） | Blackwell Tuning Guide |
| 最大驻留 **Thread Block** 数 | **32** | Blackwell Tuning Guide |
| **寄存器堆** | **65,536** 个 32-bit（256 KB） | 白皮书 + Tuning Guide |
| 每线程最大寄存器数 | 255 | Tuning Guide |
| **Shared Memory** 容量 | **128 KB**（与 L1 统一，可配置划分） | 白皮书 + Tuning Guide |
| 每 Thread Block 最大 shared memory | 99 KB（**但 D3D 限死 32 KB**） | Tuning Guide |

> 对照：CC 10.0（数据中心 GB100）是 64 warps/SM。消费级 GB20x 是 48。别拿数据中心 Blackwell 的数字套 RTX 50 系。

### 实际驻留组数 = 四个限制取最小

```
组数 = min(
    32,                                    // block 槽位
    48 / ceil(线程数/32),                   // warp 槽位
    65536 / (线程数 × 每线程寄存器数),        // 寄存器
    128KB / 每组 groupshared 用量            // shared memory
)
```

### 用你的例子实算

**`numthreads(8,8,1)`，64 线程 = 2 warp/组，假设 32 寄存器/线程、无 groupshared：**

```
block 槽位:   32 组
warp 槽位:    48 / 2       = 24 组   ← 瓶颈
寄存器:       65536/(64×32) = 32 组
shared:       无限制
→ 驻留 24 组 = 48 warp = 1536 线程 = 占用率 100% ✅
```

**`numthreads(16,16,1)`，256 线程 = 8 warp/组：**

```
warp 槽位:    48 / 8 = 6 组
寄存器:       65536/(256×32) = 8 组
→ 驻留 6 组 = 48 warp = 1536 线程 = 占用率 100% ✅
```

**`numthreads(32,32,1)`，1024 线程 = 32 warp/组：**

```
warp 槽位:    48 / 32 = 1.5 → 只能放 1 组（放不下第二组）
→ 驻留 1 组 = 32 warp = 1024 线程 = 占用率 32/48 = 66.7% ❌
```

⚠️ **这是个非常实用的结论：在 CC 12.0 上，1024 线程的线程组永远达不到满占用率。** 因为 48 不能被 32 整除，第二个组塞不进去，硬生生浪费 1/3 的 warp 槽位。同理 `numthreads(512)`（16 warp）→ 48/16 = 3 组，刚好 100% ✅。

### 寄存器压力

寄存器是最隐蔽的杀手。同样 `numthreads(16,16,1)`：

| 每线程寄存器 | 寄存器允许的组数 | 实际驻留 | 占用率 |
|-------------|----------------|---------|-------|
| 32 | 8 | 6（warp 限制） | 100% |
| 40 | 6 | 6 | 100% |
| 64 | 4 | 4 | 66.7% |
| 128 | 2 | 2 | 33.3% |
| 255 | 1 | 1 | 16.7% |

一个大循环体、一堆临时变量、内联了太多函数，就可能把寄存器从 40 推到 80，占用率直接腰斩。**用 Nsight Graphics / Nsight Compute 看 "Registers Per Thread" 和 "Achieved Occupancy"，这是唯一可靠的手段**，别靠猜。（实际分配还有粒度约束，通常按 8 个寄存器对齐，所以算出来会比理论值略差。）

### 占用率不是越高越好

低占用率但每线程寄存器多、ILP 高的 kernel，常常比高占用率的版本更快（Volkov 的经典结论）。占用率只是延迟隐藏的一个手段，**如果你的 kernel 本来就是计算密集、没什么内存等待，50% 占用率完全够用**。真正要看的指标是 SM 的 issue slot 利用率和 memory pipe 是否打满。

**但如果占用率低于 25%，几乎肯定有问题**，值得回头查寄存器和 groupshared。

---

## 七、Group Size 怎么选（实践结论）

```
✅ 必须是 32 的倍数           —— 否则尾 warp 浪费 lane
✅ 优先 64 / 128 / 256        —— 兼顾灵活性与占用率
⚠️ 避免 1024                  —— CC 12.0 上最高只有 66.7% 占用率
❌ 绝不用 (1,1,1) 或非 32 倍数
```

**形状要匹配数据访问模式**（这比大小更重要）：

| 场景 | 推荐 | 理由 |
|------|------|------|
| 全屏图像滤波 | `(8,8,1)` = 64 | 2D 局部性好，纹理缓存命中率高；组小易填满 SM |
| 更重的图像处理 | `(16,16,1)` = 256 | 组内 shared memory 复用（如高斯模糊共享 halo） |
| 线性数组 / 粒子 | `(64,1,1)` 或 `(256,1,1)` | 内存完美合并 |
| 3D 体素 | `(4,4,4)` = 64 或 `(8,8,4)` = 256 | 三维局部性 |
| 需要 wave 内归约 | `(32,1,1)` 的倍数 | 一个 warp 内可用 wave intrinsics，无需 barrier |

**AMD 兼容性提醒**：AMD 的 wavefront 是 64（GCN）或 32/64（RDNA）。如果目标平台包括主机/AMD 显卡，**64 的倍数**是更安全的选择（对 NVIDIA 也依然是 32 的倍数）。

---

## 八、Compute Shader 必须掌握的其他 GPU 概念

### 8.1 内存合并（Memory Coalescing）—— 通常是最大的性能因子

GPU 访存以 **32 字节的 sector** 为单位（L1 cache line 128 字节 = 4 个 sector）。一个 warp 的 32 条 lane 同时发起访存时，硬件会把它们合并成尽可能少的事务：

```hlsl
// ✅ 完美合并：warp 内 32 个线程访问连续 32 个 float = 128 字节 = 1 条 cache line
Buffer[id.x]

// ❌ 灾难：stride 32，32 个线程落在 32 个不同 sector = 8 倍带宽浪费（详见附录 C.3）
Buffer[id.x * 32]

// ❌ 随机访问：无法合并，每条 lane 一个事务
Buffer[hash(id.x)]
```

**你能做的最有价值的一件事，就是保证 warp 内相邻 lane 访问相邻地址。** 这经常意味着调整数据布局：

```hlsl
// ❌ AoS (Array of Structures)：读 position 时白拉了 velocity 和 mass
struct Particle { float3 pos; float3 vel; float mass; };  // 28 字节
StructuredBuffer<Particle> Particles;

// ✅ SoA (Structure of Arrays)：只读需要的，完美合并
StructuredBuffer<float3> Positions;
StructuredBuffer<float3> Velocities;
StructuredBuffer<float>  Masses;
```

### 8.2 groupshared memory（LDS）

`groupshared` 是 SM 内那 128 KB 的一块，**延迟约 20–30 周期，比 VRAM 快一到两个数量级**。核心用法是**让数据被组内多次复用**——一次读进来，多个线程反复用：

```hlsl
groupshared float4 Tile[10][10];   // 8×8 + 1 像素 halo

[numthreads(8,8,1)]
void Blur(uint3 gtid : SV_GroupThreadID, uint3 id : SV_DispatchThreadID)
{
    // 阶段 1：协作加载（每线程搬一点，包括 halo）
    Tile[gtid.y+1][gtid.x+1] = Source[id.xy];
    // ... 边缘线程额外加载 halo ...

    GroupMemoryBarrierWithGroupSync();   // 必须！等全组加载完

    // 阶段 2：从 LDS 读 9 个邻居，全部命中片上 SRAM
    float4 sum = 0;
    for (int y = 0; y < 3; y++)
      for (int x = 0; x < 3; x++)
        sum += Tile[gtid.y+y][gtid.x+x];
    Result[id.xy] = sum / 9.0;
}
```

3×3 模糊如果直接读纹理是 9 次访存；用 LDS 后每个像素只从显存读 1 次，**带宽降到 1/9**。

**Bank Conflict**：LDS 分成 **32 个 bank**，每 bank 宽 4 字节，地址按 4 字节交错。同一个 warp 内的 32 条 lane 如果访问**不同 bank**，一次完成；如果 2 条 lane 访问**同一 bank 的不同地址**，串行化成 2 次。

```hlsl
groupshared float Data[32][32];

Data[tid][0]           // ❌ 32-way conflict：所有 lane 都落在 bank 0，慢 32 倍
Data[0][tid]           // ✅ 无冲突：lane i 落在 bank i
groupshared float D2[32][33];  // ✅ padding 到 33 打散 bank，列访问也无冲突
D2[tid][0]             //    现在 lane i 落在 bank (i*33)%32 = i，无冲突
```

**广播例外**：所有 lane 读**同一个地址**是硬件广播，不算冲突，全速。

**barrier 的两条铁律**：
1. `GroupMemoryBarrierWithGroupSync()` **只同步组内**，不同步跨组。
2. 它**必须被组内所有线程一致地执行**。放在发散的 `if` 里 = 未定义行为 / 挂死：

```hlsl
if (id.x < Width) {
    ...
    GroupMemoryBarrierWithGroupSync();   // ❌ 越界线程 return 了，永远等不齐
}
```

三个变体：`GroupMemoryBarrier()`（只等 LDS 写完，不同步执行）、`DeviceMemoryBarrier()`（等 UAV 写完）、`AllMemoryBarrierWithGroupSync()`（两者都等 + 同步）。

### 8.3 Wave / Warp Intrinsics（SM 6.0+）

warp 内 32 条 lane 天生锁步，可以**免 barrier、免 LDS** 直接交换数据。这是现代 compute shader 最有价值的优化工具之一：

```hlsl
WaveActiveSum(v)          // warp 内 32 个值求和（log2(32)=5 步 shuffle，极快）
WaveActiveMax/Min(v)
WaveActiveAllTrue(cond)   // 全部满足？
WaveActiveAnyTrue(cond)   // 有任一满足？
WaveActiveCountBits(cond) // 有几条 lane 满足
WavePrefixSum(v)          // 前缀和 —— 流压缩(stream compaction)的核心
WaveReadLaneFirst(v)      // 广播第一条活跃 lane 的值
WaveGetLaneIndex()        // 我是第几条 lane [0,32)
WaveGetLaneCount()        // NVIDIA = 32
```

典型用法——**减少原子操作争用**（可能快 10 倍以上）：

```hlsl
// ❌ 32 条 lane 各发一次全局原子，全部串行化在同一地址上
uint idx;
InterlockedAdd(Counter[0], 1, idx);
Output[idx] = value;

// ✅ warp 内先归约，整个 warp 只发 1 次全局原子
uint count = WaveActiveCountBits(true);       // 本 warp 有几条活跃 lane
uint base;
if (WaveIsFirstLane())
    InterlockedAdd(Counter[0], count, base);  // 只有 1 条 lane 访问全局
base = WaveReadLaneFirst(base);
Output[base + WavePrefixCountBits(true)] = value;
```

⚠️ 注意 `WaveGetLaneCount()` 跨厂商不同（NV 32 / AMD 32 或 64 / Intel 8~32），别把 32 写死。SM 6.6 起可以用 `[WaveSize(32)]` 属性强制。

### 8.4 缓存层级与延迟量级

| 层级 | 大小 | 延迟（约） |
|------|------|-----------|
| 寄存器 | 256 KB / SM | ~1 cycle |
| Shared Memory (LDS) | 128 KB / SM（与 L1 共享） | ~20–30 cycles |
| L1 / Texture Cache | 同上，统一 | ~30–40 cycles |
| **L2** | **96 MB (5090) / 128 MB (满 GB202)** | ~200 cycles |
| VRAM (GDDR7) | 32 GB @ 1.792 TB/s | **~400–800 cycles** |

**Blackwell 的 L2 大得离谱**（Ampere GA102 只有 6 MB，Ada AD102 是 72 MB，Blackwell GB202 是 128 MB）。白皮书原话：large L2 让所有应用受益。对 compute shader 的实际意义：**中等规模的工作集（几十 MB）可以完全驻留 L2**，多 pass 算法（如迭代求解器、多级模糊、GPU 排序的多轮 pass）之间的中间结果可能根本不落到 VRAM。这在 Ampere 时代是不可能的。

### 8.5 原子操作

```hlsl
InterlockedAdd / Min / Max / And / Or / Xor / Exchange / CompareExchange
```

- 对 **groupshared** 的原子：在 SM 内完成，快。
- 对 **UAV/global** 的原子：在 L2 完成，慢得多。
- **同一地址的高争用是灾难**（全部串行）。用 §8.3 的 wave 归约，或者分散到多个计数器再最后合并。

### 8.6 Async Compute

Compute 队列可以和 Graphics 队列并行。当 graphics 在做几何处理（ROP/光栅化忙、ALU 闲）时，compute 的 warp 可以填进同一个 SM 的空闲发射槽。这是现代引擎榨干 GPU 的标准手段，也再次说明**一个 SM 上驻留的东西可以来自完全不同的地方**。

### 8.7 Compute 的启动开销

每次 `Dispatch` 都有固定开销（管线状态切换、CWD 预热、结束时的隐式同步）。**几百个只有几十个组的小 Dispatch，开销可能超过实际计算**。能合批就合批，或用 `DispatchIndirect` 让 GPU 自己决定。

---

## 九、把你的例子完整走一遍

`Dispatch(64, 64, 1)` + `numthreads(8, 8, 1)`，跑在 RTX 5090（170 SM）上：

```
1. CPU 提交 Dispatch(64,64,1)
   → 4096 个 Thread Group

2. 每个 Group: 8×8×1 = 64 线程
   → 64 / 32 = 2 个 warp（整除，无浪费 ✅）

3. 全局总量:
   4096 × 64 = 262,144 线程
   4096 × 2  = 8,192 warp

4. CWD 开始往 SM 上填。每个 SM 的限制:
   block 槽位  32
   warp 槽位   48 / 2 = 24        ← 瓶颈
   寄存器      65536/(64×R)，R≤42 时不构成瓶颈
   → 每 SM 驻留 24 个 Group = 48 warp = 1536 线程（100% 占用率）

5. 整卡容量:
   170 SM × 24 Group  = 4,080 个 Group
   170 SM × 48 warp   = 8,160 个 warp
   170 SM × 1536      = 261,120 个线程同时在飞

6. 你要跑 4096 个 Group，硬件一次能装 4080 个
   → 几乎整个 Dispatch 在同一瞬间全部驻留在 GPU 上，
     剩下 16 个组等前面的退出后补位。
```

**这个 Dispatch 对 RTX 5090 来说几乎正好是"一口"的量。** 262,144 个线程听起来吓人，但它连一个 5090 的驻留容量都刚刚填满 —— 这就是 GPU 的规模感。

而在 SM 内部：24 个 Group 的 48 个 warp 平摊到 4 个 SMSP，**每个 SMSP 驻留 12 个 warp、每周期发射其中 1 个**。你最初担心的"只占用 2 个 SMSP"，实际是 12 层深的 warp 池在 4 个 SMSP 上全速轮转。

---

## 十、常见误区速查

| 误区 | 事实 |
|------|------|
| 一个 SM 同时只跑一个 Thread Group | 最多 32 个 Group / 48 个 warp 同时驻留 |
| 一个 SMSP 同时只处理一个 warp | 驻留 12 个，每周期**发射**其中 1 个 |
| Group 的 warp 会被分散到不同 SM | **绝不会**，groupshared 和 barrier 要求同 SM |
| warp 数 = 线程数 / 32 | 是 **ceil**(线程数/32)，不整除就有 lane 浪费 |
| Group 之间可以同步 | 不能。只能拆 Dispatch。自旋等待会**死锁** |
| Group 执行顺序是有序的 | 完全无序，别依赖 |
| 占用率越高越好 | 高占用率只是手段；50% + 高 ILP 常常更快。但 <25% 基本有问题 |
| `if` 分支会跳过不执行 | warp 内发散时**两条路径都执行**，用谓词屏蔽结果 |
| 越界 `return` 能省算力 | 不能，那些 lane 仍占资源，只是不写结果 |
| `numthreads` 可以运行时改 | 编译期常量，编进二进制 |
| `numthreads(1,1,1)` 也能跑 | 能跑，但只用了 GPU 的 1/32 |
| AMP 负责调度 warp | AMP 调度 **GPU context**（毫秒级），warp 调度是 SMSP 硬件（周期级） |
| 1024 线程组能满占用率 | CC 12.0 上不能，48/32 = 1 组 → 66.7% |
| 拼作 "wrap" | 是 **warp** |

---

## 十一、检查清单

写完一个 compute shader，逐条过：

- [ ] `Tx*Ty*Tz` 是 **32 的倍数**？（跨 AMD 平台则用 64 的倍数）
- [ ] 避开了 1024 这个尺寸？（CC 12.0 上限 66.7% 占用率）
- [ ] 有向上取整派发 + shader 内的边界 `return`？
- [ ] Dispatch 任一维度没超 **65535**？
- [ ] warp 内相邻 lane 访问相邻内存（**合并**）？考虑过 SoA 而非 AoS？
- [ ] 分支边界对齐 32 线程，还是每条 lane 都不同（**发散**）？
- [ ] 有数据复用的地方用了 `groupshared`？
- [ ] LDS 的二维数组做了 **padding** 避免 bank conflict？
- [ ] `GroupMemoryBarrierWithGroupSync()` 在**非发散**路径上？
- [ ] 高频原子操作先做了 **wave 归约**？
- [ ] 没有跨组自旋等待？
- [ ] Nsight 里看过 **Registers Per Thread** 和 **Achieved Occupancy**？

---

## 附：术语对照

| NVIDIA (CUDA) | DirectX (HLSL) | Vulkan/GLSL | 本文 |
|---------------|----------------|-------------|------|
| Grid | Dispatch | Global work size | 派发 |
| Thread Block / CTA | Thread Group | Work Group | 线程组 |
| Warp (32) | Wave | Subgroup | warp / wave |
| Thread | Thread | Invocation | 线程 |
| Lane | Lane | Invocation | lane |
| Shared Memory | `groupshared` (TGSM) | `shared` | LDS |
| `__syncthreads()` | `GroupMemoryBarrierWithGroupSync()` | `barrier()` | 组内屏障 |
| `blockIdx` | `SV_GroupID` | `gl_WorkGroupID` | 组 ID |
| `threadIdx` | `SV_GroupThreadID` | `gl_LocalInvocationID` | 组内线程 ID |
| 全局索引（手算） | `SV_DispatchThreadID` | `gl_GlobalInvocationID` | 全局 ID |
| SM | — | Compute Unit（AMD 术语） | SM |
| SM Sub-Partition (SMSP) | — | — | SMSP / 处理块 |

---
---

# 附录 A：四个线程 ID 的来源与计算

## A.1 哪些是硬件给的，哪些是算出来的

只有**两个**是硬件真正产生的，另外两个是纯算术推导：

| ID | 来源 | 类型 |
|---|---|---|
| `SV_GroupID` | **CWD 分发时写进 SM 的**（这个组是第几个） | uint3 |
| `SV_GroupThreadID` | **线程在组内的位置**，由硬件线性序号解码而来 | uint3 |
| `SV_GroupIndex` | 由 `GroupThreadID` **线性化**得到 | **uint（标量）** |
| `SV_DispatchThreadID` | 由前两个**算出来** | uint3 |

## A.2 精确公式

设 `Dispatch(Gx,Gy,Gz)` + `[numthreads(Tx,Ty,Tz)]`：

```hlsl
// ① GroupID：CWD 给的，范围 [0,Gx) × [0,Gy) × [0,Gz)
uint3 gid = SV_GroupID;

// ② GroupThreadID：范围 [0,Tx) × [0,Ty) × [0,Tz)
uint3 gtid = SV_GroupThreadID;

// ③ GroupIndex：把 gtid 线性化，x 最快、z 最慢
uint gi = gtid.z * (Tx * Ty)
        + gtid.y * Tx
        + gtid.x;                    // 范围 [0, Tx*Ty*Tz)

// ④ DispatchThreadID：组的起点偏移 + 组内偏移
uint3 dtid = gid * uint3(Tx,Ty,Tz) + gtid;
```

反过来，从 `GroupIndex` 解回三维（硬件内部就是这么做的）：

```hlsl
gtid.x =  gi % Tx;
gtid.y = (gi / Tx) % Ty;
gtid.z =  gi / (Tx * Ty);
```

## A.3 完整走一遍：`Dispatch(2,2,1)` + `numthreads(4,4,1)`

4 个组 × 16 线程 = 64 线程，全局网格 8×8。

```
全局 8×8 网格（格子里是 SV_DispatchThreadID.xy）
     x→ 0    1    2    3  │  4    5    6    7
   ┌────────────────────────────────────────────
 0 │ 0,0  1,0  2,0  3,0  │ 4,0  5,0  6,0  7,0
 1 │ 0,1  1,1  2,1  3,1  │ 4,1  5,1  6,1  7,1
 2 │ 0,2  1,2  2,2  3,2  │ 4,2  5,2  6,2  7,2
 3 │ 0,3  1,3  2,3  3,3  │ 4,3  5,3  6,3  7,3
   ├─── GroupID=(0,0) ───┼─── GroupID=(1,0) ───
 4 │ 0,4  ...            │ ...
 5 │                     │
 6 │   GroupID=(0,1)     │   GroupID=(1,1)
 7 │                     │
```

**追踪一个具体线程**：它在 `GroupID=(1,0,0)` 里，`GroupThreadID=(2,3,0)`

```
GroupIndex         = 0*(4*4) + 3*4 + 2 = 14
DispatchThreadID.x = 1*4 + 2 = 6
DispatchThreadID.y = 0*4 + 3 = 3
DispatchThreadID.z = 0*1 + 0 = 0
                   → (6, 3, 0)
```

对照上图，(6,3) 确实在右上那个组的第 4 行第 3 列。✅

组 `(1,0)` 内部的 `GroupIndex` 分布（注意 x 最快）：

```
gtid.x→   0   1   2   3
gtid.y ┌────────────────
   0   │  0   1   2   3
   1   │  4   5   6   7
   2   │  8   9  10  11
   3   │ 12  13 [14] 15     ← 我们追踪的那个
```

## A.4 ⭐ `SV_GroupIndex` 为什么最关键

它是四个里**唯一的标量**，而且**它就是 warp 的打包顺序**：

```
warp 0 ← GroupIndex 0..31
warp 1 ← GroupIndex 32..63
warp 2 ← GroupIndex 64..95
```

所以对 `numthreads(8,8,1)`：

```
        gtid.x →  0  1  2  3  4  5  6  7
gtid.y=0 │  GroupIndex  0  1  2  3  4  5  6  7  ┐
gtid.y=1 │              8  9 10 11 12 13 14 15  │ warp 0
gtid.y=2 │             16 17 18 19 20 21 22 23  │ (8 宽 × 4 高)
gtid.y=3 │             24 25 26 27 28 29 30 31  ┘
gtid.y=4 │             32 33 34 35 36 37 38 39  ┐
gtid.y=5 │             40 41 42 43 44 45 46 47  │ warp 1
gtid.y=6 │             48 49 50 51 52 53 54 55  │
gtid.y=7 │             56 57 58 59 60 61 62 63  ┘
```

**一个 warp 覆盖的是 8×4 的矩形块** —— 这一条直接决定了附录 C 的内存合并结果，也决定了分支发散。改 `numthreads` 的形状，本质上就是在改"warp 覆盖数据的形状"。

## A.5 三个容易踩的坑

**坑 1：没有内置的"全局线性索引"。** 想要必须自己算，而且要用 Dispatch 的实际网格宽度，不是数据宽度：

```hlsl
// ❌ 常见错误：用了数据宽度而不是 Dispatch 网格宽度，边界不整除时全错
uint flat = dtid.y * Width + dtid.x;

// ✅ 正确（Width 恰好 = Gx*Tx 时上式才等价）
uint flat = dtid.y * (Gx * Tx) + dtid.x;
```

**坑 2：`SV_GroupIndex` 不能跨组用。** 它只在组内唯一，4096 个组里有 4096 个 `GroupIndex == 0` 的线程。

**坑 3：一维派发做了二维折叠后，别再用 `dtid.x` 当索引**（见 §1.4 的折叠写法，必须手工重组索引）。

---

# 附录 B：一个 Compute Shader 到底占用多少寄存器

## B.1 正文里的"32 寄存器/线程"是举例假设，不是下限

| Compute Shader 复杂度 | 典型寄存器/线程 |
|---|---|
| 拷贝 / 清零 / 简单缩放 | **8 – 16** |
| 3×3 / 5×5 图像滤波 | 20 – 32 |
| 带 LDS tile 的模糊、SSAO | 32 – 48 |
| 粒子模拟、光照剔除 (clustered) | 40 – 72 |
| 大展开循环、BVH 遍历、路径追踪 | 80 – 160 |
| 编译器放弃治疗 | **255（上限，再多就 spill）** |

32 大概是"中等偏轻"的水平。理论下限是 1，实际最简单的 kernel 也要 8–10 个（地址计算、循环变量、临时值）。

## B.2 与复杂度相关，但相关的是"同时活跃的变量数"

关键不是代码长度，是 **live range（活跃区间）重叠了多少**。编译器要给每个"此刻还会被用到"的值留一个寄存器：

```hlsl
// 只用 ~2 个寄存器：a 用完就死了
float a = X[i];  float b = a * 2;  Out[i] = b;

// 用 ~8 个：8 个值同时活着，直到最后一行才全部消费
float v0=X[i+0]; float v1=X[i+1]; /* ... */ float v7=X[i+7];
Out[i] = v0+v1+v2+v3+v4+v5+v6+v7;
```

**寄存器暴涨的四大元凶：**

1. **`[unroll]`** —— 头号杀手。展开 16 次的循环会让 16 个迭代的临时值同时活着。
2. **多笔并发访存** —— 每个"已发出但还没回来"的 load 都要占一个目标寄存器保持活跃。批量预取 16 个纹理样本 = 至少 16×4 个寄存器被钉住。
3. **函数内联** —— HLSL 全部内联，被调用函数的局部变量并入调用者的活跃集。
4. **动态下标的本地数组** `float tmp[16]; tmp[i]=...` —— 编译器无法放进寄存器，会 **spill 到 local memory**（物理上就是 VRAM，经 L1/L2 缓存），延迟从 1 周期变成几百周期。最坏情况。

## B.3 怎么测出来

**先说个反直觉的事实：HLSL 字节码里没有真实寄存器数。** DXBC/DXIL 用虚拟寄存器，**真正的分配发生在驱动里** —— 创建 PSO 时驱动把 DXIL 编译成 NVIDIA 的 SASS 机器码，那一步才做寄存器分配。所以 `fxc` / `dxc` 的输出**不是**答案。

按可靠性排序：

**① Nsight Graphics（D3D12 / Vulkan，最正统）**
`GPU Trace` 或 `Shader Profiler` 里能看到每个 shader 的 **Registers Per Thread** 和 **Theoretical / Achieved Occupancy**。这是 NVIDIA + 图形 API 下唯一直接读到 SASS 分配结果的途径。

**② 能把逻辑搬到 CUDA 复现的话**

```bash
nvcc -arch=sm_120 -Xptxas=-v -c kernel.cu
```

直接打印 `Used 34 registers, 0 bytes smem, ... 0 bytes spill stores`。
⚠️ **`spill stores / spill loads` 非 0 就是红灯。**

**③ `fxc /Fc` 的 `dcl_temps` —— 粗糙代理，聊胜于无**

```bash
fxc /T cs_5_0 /E CSMain /Fc out.asm shader.hlsl
```

开头会有 `dcl_temps 12`，即 12 个四分量虚拟临时寄存器。**它不等于 SASS 寄存器数**（SASS 是标量的，驱动还会重新调度、重算、合并），但趋势可用：`dcl_temps` 从 8 涨到 40，实际寄存器八成也涨了。

**④ 反向推算（不装工具的土办法）**

Nsight 里读到 Achieved Occupancy，反推：

```
每 SM 驻留组数 R  →  R × 每组线程数 × 每线程寄存器数 ≤ 65536
```

例：`numthreads(16,16,1)` 实测只驻留 4 组（而 warp 槽位允许 6 组），说明卡在寄存器上：
`65536 / (4 × 256) = 64` → 每线程约 **57–64** 个寄存器。

**⑤ AMD 的 RGA 当交叉参考**

[Radeon GPU Analyzer](https://gpuopen.com/rga/) 能离线编译 HLSL 直接给出 VGPR/SGPR 数，装完即用、不需要跑起来。**数字不能直接套到 NVIDIA**，但"这个 shader 是不是寄存器压力大"的判断是通用的：改一版代码 VGPR 从 40 降到 24，在 NVIDIA 上大概率也降。

## B.4 降寄存器的手段

```hlsl
[loop]      for (...)   // 阻止展开，最直接有效
[unroll(4)] for (...)   // 部分展开，折中
```

- 缩短 live range：把变量定义挪到靠近使用点
- 把大的 `float tmp[N]` 改成 `groupshared`（换个存储层级，LDS 也是片上的）
- 拆成两个 Dispatch —— 一个巨型 kernel 拆两半，两边都能满占用率，总时间反而更短

⚠️ D3D **没有**类似 CUDA `__launch_bounds__` / `-maxrregcount` 的官方口子强制限制寄存器，只能靠改代码。

---

# 附录 C：内存合并（Memory Coalescing）与 stride 详解

## C.1 stride 是什么

**stride（步长）= warp 内相邻两条 lane 访问的地址之间隔了多远。**

```hlsl
Buffer[id.x]        // lane0→元素0, lane1→元素1,  lane2→元素2  ...  stride = 1
Buffer[id.x * 2]    // lane0→元素0, lane1→元素2,  lane2→元素4  ...  stride = 2
Buffer[id.x * 32]   // lane0→元素0, lane1→元素32, lane2→元素64 ...  stride = 32
```

就这么简单：**下标乘的那个系数就是 stride**。stride = 1 叫"连续访问"，是唯一理想的情况。

## C.2 为什么 stride 决定性能：硬件按"块"搬数据

GPU **不能只取 4 个字节**。最小搬运单位是 **32 字节的 sector**（L1 cache line = 128 字节 = 4 个 sector）。你要 1 个 float（4 字节），硬件也得把包含它的整个 32 字节搬过来。

一个 warp 的 32 条 lane 同时发起访存时，硬件会看这 32 个地址落在哪些 sector 里，然后**只搬那些 sector**。

## C.3 三个例子，画出来看

设 `Buffer<float>`，每元素 4 字节。**1 个 sector = 32 字节 = 8 个 float。**

### 例 A：`Buffer[id.x]`，stride = 1 ✅

```
32 条 lane 要的元素：  0  1  2  3 ... 30 31
字节地址范围：         0 ─────────────→ 127

内存里的 sector 划分（每格 32 字节 = 8 个 float）：
┌────────┬────────┬────────┬────────┐
│sector 0│sector 1│sector 2│sector 3│
│elem0-7 │elem8-15│e16-23  │e24-31  │
└────────┴────────┴────────┴────────┘
  ↑全用    ↑全用    ↑全用    ↑全用

搬运：4 个 sector = 128 字节
使用：128 字节
效率：100%  ← 一次访存喂饱整个 warp
```

### 例 B：`Buffer[id.x * 2]`，stride = 2 ⚠️

```
要的元素：0  2  4  6 ... 60 62
字节范围：0 ─────────────→ 251

┌────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐
│sector 0│sector 1│sector 2│sector 3│sector 4│sector 5│sector 6│sector 7│
│e0-7    │e8-15   │e16-23  │e24-31  │e32-39  │e40-47  │e48-55  │e56-63  │
└────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘
  用4/8    用4/8    用4/8    ... 每个 sector 只用一半

搬运：8 个 sector = 256 字节
使用：128 字节
效率：50%  ← 带宽白扔一半
```

### 例 C：`Buffer[id.x * 32]`，stride = 32 ❌

一个 sector 装 8 个 float，stride = 32 意味着**每条 lane 都落在完全不同的 sector 里**：

```
lane0 → 元素0    (sector 0)
lane1 → 元素32   (sector 4)     ← 跳过了 sector 1,2,3
lane2 → 元素64   (sector 8)
...
lane31→ 元素992  (sector 124)

┌────┐ ┌────┐ ┌────┐        ┌────┐
│sec0│ │sec4│ │sec8│  ...   │s124│    32 个互不相邻的 sector
└────┘ └────┘ └────┘        └────┘
 用4B   用4B   用4B          用4B     每个只用 4/32 字节

搬运：32 个 sector = 1024 字节
使用：128 字节
效率：12.5%  ← 8 倍带宽浪费
```

> 注：按 128B cache line 数是 32 条线，但真正的搬运粒度是 32B sector，所以对 4 字节元素的最坏浪费是 **8 倍**，不是 32 倍。

## C.4 一句话规则

> **保证 `id.x`（warp 内变化最快的那个）直接对应内存里连续的元素。**

## C.5 实战场景一：一维索引写反了（最常见的真实 bug）

图像存在 `RWStructuredBuffer<float4>` 里，行主序：

```hlsl
// ✅ 正确：x 变化最快 ⇒ warp 内地址连续 ⇒ stride = 1
uint idx = id.y * Width + id.x;

// ❌ 灾难：warp 内 lane 差 1 就跳一整列 ⇒ stride = Height
uint idx = id.x * Height + id.y;
```

第二种写法逻辑完全正确、结果完全对，但**慢 8 倍**。这种 bug 不会崩、不会出错、只会慢，所以特别隐蔽。

## C.6 实战场景二：`numthreads` 的形状会破坏合并 ⭐

回到附录 A.4 —— warp 覆盖的是矩形块，**块的宽度决定每行取多少连续字节**：

| numthreads | warp 0 覆盖 | 每行连续字节（元素为 float4 = 16B） | 效率 |
|---|---|---|---|
| `(32,1,1)` | 32×1 | 512 B（4 条完整 cache line） | 100% ✅ |
| `(8,8,1)` | **8×4** | 8×16 = **128 B = 完整一条 line** | 100% ✅ |
| `(16,16,1)` | 16×2 | 256 B | 100% ✅ |
| `(4,16,1)` | **4×8** | 4×16 = **64 B**（半条 line） | 还行 |
| `(2,32,1)` | **2×16** | 2×16 = **32 B**（正好 1 个 sector） | 勉强 |
| `(1,64,1)` | **1×32** | **16 B < 32B sector** | **50%** ❌ |

**由此可以推出一条硬规则：**

```
numthreads.x × 单元素字节数  ≥ 32 字节（sector 大小）
最好 ≥ 128 字节（完整 cache line）
```

- 元素是 `float`（4B）→ **Tx ≥ 8**
- 元素是 `float4`（16B）→ **Tx ≥ 2**；Tx = 8 时正好一条 cache line

**这就是 `numthreads(8,8,1)` 成为图像处理默认选择的真正原因** —— 不是因为 8×8 好看，而是三个条件同时命中：

1. 8 个 float4 = 128 字节 = 恰好一条 L1 cache line（完美合并）
2. 64 线程 = 2 个整 warp（无 lane 浪费）
3. CC 12.0 上能驻留 24 组 = 48 warp（100% 占用率）

> ⚠️ 这条规则针对 **Buffer / StructuredBuffer 的线性索引**。`Texture2D` 走纹理单元，硬件用 **swizzle / tiled 布局**（Z-order），2D 邻近像素在物理内存里本来就邻近，所以纹理采样对 warp 形状不那么敏感。

## C.7 实战场景三：AoS vs SoA 的数字账

```hlsl
struct Particle { float3 pos; float3 vel; float mass; };  // 28 字节
StructuredBuffer<Particle> Particles;

float3 p = Particles[id.x].pos;    // 只要 12 字节
```

32 条 lane 读的地址是 0, 28, 56, …, 868，跨度 880 字节 ≈ 28 个 sector 全部被搬：

```
搬运：≈ 896 字节
使用：32 × 12 = 384 字节
效率：≈ 43%
```

**AoS 的效率大致 ≈ 需要的字段大小 / 结构体总大小。** 如果结构体膨胀到 64 字节而你只读一个 `float`，效率掉到 **6%**。

改 SoA 后：

```hlsl
StructuredBuffer<float4> Positions;   // 独立数组

float3 p = Positions[id.x].xyz;
// 地址 0,16,32,…,496 完全连续 → 512 字节搬运，512 字节使用 → 100%
```

**判断标准**：如果一个 pass 只用到结构体的一部分字段，就该拆成 SoA；如果每次都要全部字段，AoS 反而好（一次搬完，缓存友好）。

## C.8 实战场景四：转置——读写不可能都连续时

矩阵转置里，读连续则写必然 stride = N，反之亦然。**解法是用 `groupshared` 当中转站**：

```hlsl
groupshared float Tile[32][33];   // ← 33 不是笔误，padding 防 bank conflict

[numthreads(32,8,1)]
void Transpose(uint3 gid : SV_GroupID, uint3 gtid : SV_GroupThreadID)
{
    // 读：连续 ✅（x 沿源矩阵的行）
    for (uint i = 0; i < 32; i += 8)
        Tile[gtid.y + i][gtid.x] =
            In[(gid.y*32 + gtid.y + i) * N + gid.x*32 + gtid.x];

    GroupMemoryBarrierWithGroupSync();

    // 写：也连续 ✅（转置在片上的 LDS 里完成，那儿不规则访问几乎免费）
    for (uint i = 0; i < 32; i += 8)
        Out[(gid.x*32 + gtid.y + i) * N + gid.y*32 + gtid.x] =
            Tile[gtid.x][gtid.y + i];
}
```

**这是 `groupshared` 最典型的用途之一：把"显存里代价高昂的不规则访问"搬到"片上代价极低的不规则访问"。**

---
---

# 附录 D：CWD 是什么 + ID 范围的三个易错点

## D.1 CWD = Compute Work Distributor（计算工作分发器）

GPU 前端的一个固定功能硬件单元。NVIDIA 把前端调度硬件统称 **GigaThread Engine**，其中负责 compute 的那部分就是 CWD：

```
Command Processor（解析命令流，看到 Dispatch(64,64,1)）
      ↓
GigaThread Engine
  ├── CWD (Compute Work Distributor)   ← 分发 Thread Group
  └── 图形工作分发器                     ← 分发图元、像素 warp
      ↓
各个 SM
```

### 它干的活

CWD 手里握着 4096 个待分发的 Thread Group，做的事就一件：**不停地问每个 SM"你还塞得下一整个组吗"，塞得下就放一个进去**。

判断依据就是 §6 那四类资源：

```
该 SM 当前 block 槽位没满（< 32）？
该 SM 剩余 warp 槽位够这组用？
该 SM 剩余寄存器够 (线程数 × 每线程寄存器数)？
该 SM 剩余 shared memory 够这组的 groupshared？
      ↓ 四个全过
放置整个 Group（all-or-nothing，不能只放一半）
```

有 Group 执行完退出、腾出资源，CWD 立刻补下一个进去。整个 Dispatch 期间它一直在做这个填坑动作。

### 为什么要知道它

§3 那三条规则，根源都在 CWD：

- **Group 执行顺序无保证** —— CWD 按线性顺序取，但哪个 SM 先空出来是随机的，所以完成顺序乱序。
- **跨组自旋等待会死锁** —— 你等的那个组可能还在 CWD 的队列里没被分发，而你占着的资源正是它需要的。
- **驻留后不迁移** —— CWD 只负责"放进去"，没有"搬出来再放别处"的能力。

### 三级调度粒度对照

| 缩写 | 全称 | 调度对象 | 时间粒度 |
|---|---|---|---|
| **AMP** | AI Management Processor（Blackwell 新增） | GPU **context** | 毫秒级 |
| **CWD** | Compute Work Distributor | **Thread Group → SM** | 微秒级 |
| SMSP warp scheduler | — | **warp → 执行单元** | **单时钟周期** |

三者差 6 个数量级，属于完全不同的层次，别混为一谈。（GigaThread Engine 是包含 CWD 的整个前端调度模块；SM = Streaming Multiprocessor；SMSP = SM Sub-Partition，也叫 Processing Block。）

---

## D.2 ID 范围的三个易错点

以 `Dispatch(64,64,1)` + `numthreads(8,8,1)` 为例。

### 易错点 1：区间要用半开区间

`[0,64]` 表示 0…64，是 **65** 个值。正确写法是 **`[0,64)`**，即 0…63，共 64 个。

### 易错点 2：z 分量的范围来自各自的维度，三个分量互不相同

**`Dispatch(64,64,1)` → `SV_GroupID`**

```
x ∈ [0, 64)   → 0…63
y ∈ [0, 64)   → 0…63
z ∈ [0,  1)   → 只有 0        ← 不是 [0,64)
```

**`numthreads(8,8,1)` → `SV_GroupThreadID`**

```
x ∈ [0, 8)    → 0…7
y ∈ [0, 8)    → 0…7
z ∈ [0, 1)    → 只有 0        ← 不是 [0,8)
```

`Dispatch` 和 `numthreads` 的第三个数都是 1，所以 z 恒为 0。只有写 `numthreads(8,8,4)` 时 z 才会取到 0…3。

### 易错点 3：`GroupThreadID` / `GroupIndex` 跨组会重复

准确说法是：**每个组内**有 64 个不同的 `GroupThreadID`，而这 64 组坐标在 **4096 个组里各重复一遍**。

全 GPU 有 4096 个线程的 `GroupThreadID` 都等于 `(0,0,0)`。**`GroupThreadID` 和 `GroupIndex` 都只在组内唯一。** 全局唯一的只有 `SV_DispatchThreadID`。

### 完整对照表

| ID | 范围 | 数量 | 唯一性 |
|---|---|---|---|
| `SV_GroupID` | `[0,64) × [0,64) × [0,1)` | 4096 种 | **全局唯一**（标识哪个组） |
| `SV_GroupThreadID` | `[0,8) × [0,8) × [0,1)` | 64 种 | 组内唯一，**跨组重复** |
| `SV_GroupIndex` | `[0,64)` 即 0…63 | 64 种 | 组内唯一，**跨组重复** |
| `SV_DispatchThreadID` | `[0,512) × [0,512) × [0,1)` | 262,144 种 | **全局唯一** |

`DispatchThreadID` 的范围 = `Dispatch` × `numthreads` = 64×8 = **512**，这是全局网格的真实尺寸。

---

## D.3 `GroupIndex` 与 warp 的对应（再确认一次）

warp 的切分**就是按 `GroupIndex` 的顺序**：

```
GroupIndex  0 … 31  →  warp 0
GroupIndex 32 … 63  →  warp 1
```

再往回推一步：`GroupIndex 0..31` 对应的 `GroupThreadID` 是 y = 0…3 的四行（因为 x 变化最快，8 个一行，4 行 = 32），所以 **warp 0 覆盖的是 8×4 的矩形**。

这正是附录 A.4 和 C.6 讲的那件事 —— **`numthreads` 的形状决定 warp 覆盖数据的形状，进而决定内存合并效率和分支发散。**

---

## D.4 附带：没有内置的"第几个组"

`SV_GroupID` 是 **uint3**，没有一维的线性组编号。想要得自己算：

```hlsl
uint linearGroupID = gid.z * (Gx * Gy) + gid.y * Gx + gid.x;   // 0…4095
```

而且 `Gx`、`Gy` 必须自己通过 constant buffer 传进去 —— **shader 里读不到 `Dispatch` 的参数**。这一点和 `numthreads`（编译期就写死在二进制里、shader 自己知道）正好相反。

---
---

# 附录 E：内存布局 vs 访问模式 —— `numthreads.x` 到底改变了什么

## E.1 这是两件独立的事

常见误解是"`numthreads` 的 x 决定了内存布局"。**不是。** 需要分清：

| | 谁决定 | 说明 |
|---|---|---|
| **内存布局** (layout) | 数据本身：你怎么建 buffer/texture、索引公式怎么写 | 一张固定的地图 |
| **访问模式** (access pattern) | `numthreads` 的形状 → 哪 32 个线程凑成一个 warp | 一次踩哪 32 个格子 |

> **合并效率 = 这两者是否对得上。**

改 `numthreads.x` 不会动内存里任何一个字节的位置，它改变的是**一个 warp 的 32 条 lane 落在这张地图上的形状** —— 是横着一条 32 长的线，还是 8×4 的方块。同一份数据、同一个布局，`numthreads(32,2,1)` 和 `numthreads(8,8,1)` 踩出来的形状完全不同。

## E.2 内存布局的四个层次（"是否取决于物理内存"）

```
① 你的索引公式          idx = y*Width + x        ← 你写的，完全可控
        ↓
② API/驱动的物理排布
   Buffer/StructuredBuffer → 线性 (pitch-linear)，虚拟地址连续
   Texture2D              → swizzled / tiled (Z-order)，驱动决定，你看不见
        ↓
③ 虚拟地址 → 物理显存页   GPU 页表，通常 64 KB 大页
        ↓
④ 物理地址 → GDDR7 通道 / bank / row   硬件哈希交错
```

**最终确实取决于物理内存，但 ②③④ 这三层是设计成"让连续虚拟地址高效"的**，所以你只需要管好第 ① 层：

- **③ 页很大**：一个 warp 一次最多摸 128–1024 字节，远小于 64 KB 页。**虚拟连续 ≈ 物理连续**，几乎不可能跨页。
- **④ 地址交错是故意的**：硬件把地址哈希打散到 16 个显存控制器上，目的就是让**连续的大块访问自动铺满所有通道**吃满带宽。
  - ⚠️ 反过来，如果 stride 恰好等于交错周期，会出现 **partition camping**（所有访问挤在一个通道上）—— 这是 stride 访问除了浪费 sector 之外的**第二重惩罚**。

实践上的抽象很干净：**只要保证 warp 内 lane 摸连续地址，下面三层会自动做对。**

## E.3 ⚠️ "8×8 比 32×2 差一个数量级" 是错的 —— 要看元素大小

网上常见这个说法：`numthreads(8,8,1)` 下 warp 0 跨 4 行 → "4 段不连续访存"，比 `numthreads(32,2,1)` 的 1 段连续差一个数量级。

**对 `float` 和 `float4` 不成立。** 实算（行间距 W 很大，两者都是 64 线程 / 2 warp）：

**元素 = `float4`（16 字节）**

```
numthreads(8,8,1)   warp0 = 4 行 × 8 列
  每行 8×16 = 128 字节 = 恰好一条完整 cache line
  → 4 条 cache line，搬 512 字节，用 512 字节    效率 100% ✅

numthreads(32,2,1)  warp0 = 1 行 × 32 列
  512 字节连续 = 4 条 cache line
  → 搬 512 字节，用 512 字节                     效率 100% ✅
```

**字节流量完全一样。** 区别只是 4 条 cache line 是散开的还是挨着的 —— 影响 DRAM row buffer 命中率和预取，是**百分之几**的差别，不是一个数量级。

**元素 = `float`（4 字节）**：8×4 = 32 字节 = 恰好 1 个 sector，全用 → 仍然 **100%**。

**真正会翻车的是小元素：**

| 元素类型 | `numthreads.x = 8` 时每行字节 | 效率 |
|---|---|---|
| `float4` (16B) | 128 B = 完整 cache line | **100%** ✅ |
| `float2` (8B) | 64 B = 2 sector | **100%** ✅ |
| `float` (4B) | 32 B = 1 sector | **100%** ✅ |
| `half` / R16 (2B) | 16 B < 32 B sector | **50%** ⚠️ |
| `R8` (1B) | 8 B | **25%** ❌ |

判据仍然是附录 C.6 那条：

```
numthreads.x × 单元素字节数  ≥ 32 字节
```

`Tx = 8` 时，元素 ≥ 4 字节就达标。**所以 `(8,8,1)` 处理 float / float4 图像完全没问题。**

## E.4 反向的点：纹理反而偏好方块

如果数据是 `Texture2D`（走 ② 的 swizzled 布局），**8×4 的方块比 32×1 的长条更好** —— Z-order 交错正是按方块组织的，方形 warp 的 footprint 落在更少的 tile 里。这也是硬件像素着色用 2×2 quad、GPU 纹理缓存按方块组织的原因。

## E.5 完整的形状选择依据

| 情况 | 选择 |
|---|---|
| 线性 Buffer / StructuredBuffer | 保证 `Tx × 元素字节 ≥ 32 B`；达标之后方块或长条都行 |
| `Texture2D` 采样为主 | 偏方块（`(8,8,1)`、`(16,16,1)`），匹配 swizzle |
| 分支条件跟 `y` 相关 | 用长条（`(32,·,1)`），让整个 warp 落在同一行 → 零发散 |
| 分支条件跟 `x` 相关 | 用方块，或把边界对齐到 32 |
| 元素是 `half` / `R8` 等小类型 | **必须**加大 `Tx`（≥16 或 32），否则 sector 用不满 |

---
---

# 附录 F：warp 形状为什么决定访存效率 —— 最核心的解释

## F.0 一句话核心

> **一个 warp 的 32 条 lane 一起执行同一条 load 指令 → 一次产生 32 个地址。硬件不能按字节取，只能按 32 字节的 sector 取。它看这 32 个地址覆盖了几个 sector，就搬几个 sector。**
>
> **所以：32 个地址挤在越少的 sector 里越快。而 `numthreads` 的形状，决定的正是"这 32 个地址长什么样"。**

## F.1 为什么"形状"能影响地址分布

因为**二维数据在内存里是一维的**：

```
你眼里的图像                    内存里的真相（一条直线）
┌───────────────┐
│ 行0: A B C D  │              A B C D  E F G H  I J K L
│ 行1: E F G H  │   ────→      └─行0─┘  └─行1─┘  └─行2─┘
│ 行2: I J K L  │
└───────────────┘              同一行内相邻 = 地址相邻 ✅
                               相邻两行之间 = 隔了整整 Width 个元素 ❌
```

于是：

- warp 在**横向**铺开 → 地址连成一整片 → 装进很少的 sector ✅
- warp 在**纵向**铺开 → 地址被行距**撕开** → 每条 lane 各占一个 sector ❌

> **warp 的宽度决定"连成一片的长度"，warp 的高度决定"被撕成几段"。**

## F.2 完整例子：同一份数据，只改形状

**设定**：图像 64 列宽，元素是 `float`（4 字节）。

- 一行 = 64 × 4 = **256 字节** = 8 个 sector
- 1 个 sector = 32 字节 = **8 个 float**
- 索引都是 `Buffer[id.y * 64 + id.x]`，**完全一样，不改一个字**

把内存画成一条 sector 带：

```
sector:  0  1  2  3  4  5  6  7 │ 8  9 10 11 12 13 14 15 │16 17 ...
         └──────── 行0 ────────┘ └──────── 行1 ────────┘ └── 行2
```

### A) `numthreads(32,1,1)` — warp = 32 列 × 1 行

```
覆盖：行0 的第 0..31 列  →  字节 0..127

sector:  [0][1][2][3] 4  5  6  7 │ 8 ...
         ■■ ■■ ■■ ■■              ■ = 全部用上

搬运 4 个 sector = 128 字节
使用             = 128 字节
效率 = 100% ✅
```

### B) `numthreads(8,4,1)` — warp = 8 列 × 4 行

8 个 float = 32 字节 = **恰好一个完整 sector**：

```
行0 第0-7列 → sector 0   ■■ (32/32 全用)
行1 第0-7列 → sector 8   ■■
行2 第0-7列 → sector 16  ■■
行3 第0-7列 → sector 24  ■■

搬运 4 个 sector = 128 字节
使用             = 128 字节
效率 = 100% ✅   ← 跟 A 一模一样！
```

**注意这里**：形状变成方块了，但只要每段刚好填满 sector，效率不掉。这就是附录 E.3 说的"8×8 比 32×2 差一个数量级"为什么是错的。

### C) `numthreads(4,8,1)` — warp = 4 列 × 8 行

4 个 float = **16 字节，只有半个 sector**：

```
行0 第0-3列 → sector 0   ■□ (用 16，搬 32)
行1 第0-3列 → sector 8   ■□
行2 第0-3列 → sector 16  ■□
...
行7 第0-3列 → sector 56  ■□

搬运 8 个 sector = 256 字节
使用             = 128 字节
效率 = 50% ⚠️      ← 一半带宽扔掉了
```

### D) `numthreads(1,32,1)` — warp = 1 列 × 32 行

每条 lane 只要 4 字节，却各自触发一个完整 sector：

```
行0  第0列 → sector 0    ■□□□□□□□ (用 4，搬 32)
行1  第0列 → sector 8    ■□□□□□□□
行2  第0列 → sector 16   ■□□□□□□□
...
行31 第0列 → sector 248  ■□□□□□□□

搬运 32 个 sector = 1024 字节
使用              =  128 字节
效率 = 12.5% ❌     ← 8 倍浪费
```

### 汇总：同样 32 个线程、同样的数据、同样的索引公式

| numthreads | warp 形状 | 每段字节 | 搬运 | 使用 | 效率 |
|---|---|---|---|---|---|
| `(32,1,1)` | 32 × 1 | 128 | 128 B | 128 B | **100%** |
| `(8,4,1)` | 8 × 4 | 32 | 128 B | 128 B | **100%** |
| `(4,8,1)` | 4 × 8 | 16 | 256 B | 128 B | **50%** |
| `(2,16,1)` | 2 × 16 | 8 | 512 B | 128 B | **25%** |
| `(1,32,1)` | 1 × 32 | 4 | 1024 B | 128 B | **12.5%** |

**唯一变的是 `numthreads` 的形状，性能差 8 倍。** 这就是"warp 形状决定访存效率"的全部含义。

## F.3 压成一个公式

从上表能直接推出闭式解：

```
每段连续字节 = Tx × 元素字节数
段数         = 32 / Tx

效率 = min(1,  Tx × 元素字节数 / 32)
                └──────┬──────┘
                 一段能不能填满一个 sector
```

验证：

| | Tx × 元素字节 | 效率 |
|---|---|---|
| `Tx=8`, `float`(4B) | 32 | min(1, 1.0) = **100%** |
| `Tx=8`, `float4`(16B) | 128 | min(1, 4.0) = **100%** |
| `Tx=4`, `float`(4B) | 16 | min(1, 0.5) = **50%** |
| `Tx=8`, `half`(2B) | 16 | min(1, 0.5) = **50%** |
| `Tx=8`, `R8`(1B) | 8 | min(1, 0.25) = **25%** |

**所以判据只有一条：**

```
Tx × 单元素字节数  ≥  32
```

**≥ 32 就满效率，再大也不会更好；< 32 就按比例线性掉。**

> 前提：行与行在内存里离得远，即 `Width × 元素字节 ≥ 32`。小图像行紧挨着时会好一些。

## F.4 容易搞反的实战例子：垂直模糊

这是最能说明"warp 形状"和"读取方向"是两回事的场景。

```hlsl
// 垂直方向 9-tap 模糊：每条线程沿 y 读 9 个像素
[numthreads(?, ?, 1)]
void VerticalBlur(uint3 id : SV_DispatchThreadID)
{
    float4 sum = 0;
    for (int k = -4; k <= 4; k++)
        sum += Src[(id.y + k) * Width + id.x];   // ← 沿 y 走
    Dst[id.y * Width + id.x] = sum / 9.0;
}
```

直觉会说："我在纵向读，那 warp 也该是纵向的" → `numthreads(1,64,1)`。

**完全反了。** 关键在于**同一时刻 32 条 lane 在读什么**：

```
循环第 k 步，warp 内 32 条 lane 同时执行这一条 load：
   lane0  读 (id.y+k, x0)
   lane1  读 (id.y+k, x1)      ← 同一行！不同列！
   ...
   lane31 读 (id.y+k, x31)
```

**每条 lane 沿着自己那一列往下走，但在任意一个瞬间，32 条 lane 都停在同一行上。** 所以决定合并的仍然是 lane 在 **x 方向**的分布：

- `numthreads(32,2,1)` → 每步 32 个连续元素 → **100%** ✅
- `numthreads(1,64,1)` → 每步 1 个元素 ×（warp 内 32 个不同 y）→ **12.5%** ❌

> **结论：warp 形状看的是"同一条指令产生的 32 个地址"，跟循环走哪个方向无关。任何情况下都让 warp 横着躺。**

## F.5 三句话总结

1. **warp = 一条指令 32 个地址**，硬件按 32 字节 sector 搬运，只搬被覆盖到的那些。
2. **二维数据在内存里是一维的**，所以 warp 横向铺开地址连片、纵向铺开地址被行距撕开。
3. **判据：`Tx × 元素字节 ≥ 32`**。达标就满效率，不达标按比例线性掉，最差 12.5%。
