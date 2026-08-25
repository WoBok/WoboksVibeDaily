---
title: "HLSL Buffer 类型、视图与选择：Structured、Typed、Raw 与 cbuffer"
date: "2026-08-25"
summary: "从数据布局、寻址、视图格式与读写权限梳理 HLSL Structured、Typed、Raw Buffer 和 cbuffer 的差异、UE RDG 绑定方式及选择原则。"
category: "Computer Graphics"
tags:
  - "HLSL"
  - "GPU Buffer"
  - "SRV"
  - "UAV"
  - "UE RDG"
---

本文从数据布局、寻址方式、资源视图和读写权限四个角度，说明以下 HLSL 数据类型：

```hlsl
StructuredBuffer<T>
RWStructuredBuffer<T>

Buffer<T>
RWBuffer<T>

ByteAddressBuffer
RWByteAddressBuffer

cbuffer
```

前三组用于访问 Buffer 资源，可以按两条轴线理解：

1. **字节如何解释**：Structured、Typed、Raw。
2. **Shader 是否可以写入**：无 `RW` 绑定 SRV；有 `RW` 绑定 UAV。

`cbuffer` 则是独立的常量参数路径，主要用于向一次 Draw 或 Dispatch 提供少量只读参数。

---

## 1. Buffer、View 与 HLSL 声明

GPU Buffer 在底层是一段线性内存。字节本身不记录“这是 `float3`、结构体还是颜色”，具体含义来自资源描述、View 和 HLSL 声明之间的共同约定。

```text
Buffer 资源
    保存字节并规定总大小、usage 等资源属性
        ↓
SRV / UAV
    规定可访问范围、解释方式和读写权限
        ↓
HLSL 声明
    规定 Shader 端采用的资源类型和访问语法
```

- **SRV（Shader Resource View）**：Shader 只读视图。
- **UAV（Unordered Access View）**：Shader 可读写视图。
- **Uniform Buffer / CBV**：`cbuffer` 使用的常量参数绑定路径。

View 与 Buffer 不是一一对应。一个 Buffer 可以不创建 SRV/UAV，也可以在资源属性兼容时创建多个不同范围或用途的 View。

CPU 创建的资源与 View 必须和 HLSL 声明匹配；否则可能出现错位读取、错误的格式转换、越界访问或资源验证错误。

---

## 2. 类型总览

### 2.1 三类资源 Buffer 的核心区别

| HLSL 类型 | 第 `i` 项地址 | 单项大小来自 | 位如何解释 | 典型 View |
|---|---|---|---|---|
| `StructuredBuffer<T>` | `Base + i × stride` | Structured stride | HLSL 的 `T` 及其字段布局 | SRV |
| `Buffer<T>` | `Base + i × FormatSize` | View format | 按格式解码，并可自动转换 | SRV |
| `ByteAddressBuffer` | Shader 直接给出字节地址 | 每条 `Load*` 指令 | Shader 手动解释位模式 | SRV |

对应的 `RW*` 类型保持相同的寻址和解释方式，但改用 UAV，并允许 Shader 写入。

### 2.2 cbuffer 的位置

| 类型 | 主要用途 | 访问方式 | 布局来源 | Shader 写入 |
|---|---|---|---|---|
| `cbuffer` | 少量执行参数 | 按成员名 | cbuffer 的 16 字节打包规则 | 不允许 |
| Structured | 规则结构数组 | 元素索引 | stride + `T` | RW 版本允许 |
| Typed | 标准格式标量/向量数组 | 元素索引 | View format | RW 版本允许 |
| Raw | 自定义字节协议 | 字节偏移 | Shader 手动定义 | RW 版本允许 |

可以将它们概括为：

```text
cbuffer：本次执行使用哪些参数？
SRV：    本次执行读取哪些数据？
UAV：    本次执行产生或修改哪些数据？
```

---

## 3. StructuredBuffer：按固定结构步长访问

### 3.1 模型

```hlsl
StructuredBuffer<FElement> InputData;
RWStructuredBuffer<FElement> OutputData;
```

Structured Buffer 将内存视为固定步长元素的数组：

```text
第 i 项地址 = View 起始地址 + i × StructureByteStride
```

Shader 只提供元素索引，GPU 根据 stride 找到该元素，再按照 HLSL 的 `T` 读取字段。

### 3.2 读取方式与布局

```hlsl
struct FElement
{
    float3 Vector;
    float Weight;
};

StructuredBuffer<FElement> Elements;

FElement Value = Elements[Index];
float3 V = Value.Vector;
```

`StructureByteStride` 必须与 CPU 上传元素的实际大小以及 HLSL 的字段布局一致。Structured Buffer 通常使用 `PF_Unknown`，因为它不依靠像素格式描述元素。

Structured Buffer 不使用 cbuffer 的 16 字节寄存器装箱规则。例如：

```hlsl
StructuredBuffer<float3> Vectors;
```

若 stride 为 12 字节，则布局是：

```text
Vectors[0]：字节  0..11
Vectors[1]：字节 12..23
Vectors[2]：字节 24..35
```

`float3` 不会自动变成 16 字节元素。复杂结构应在 CPU 和 HLSL 两端使用明确位宽，并通过 `static_assert(sizeof(...))`、显式 padding 等方式确认布局。

### 3.3 UE RDG 创建方式

```cpp
FRDGBufferDesc Desc =
    FRDGBufferDesc::CreateStructuredDesc(
        sizeof(FElement),
        ElementCount);

Desc.Usage |= EBufferUsageFlags::ShaderResource;

FRDGBufferRef ElementBuffer =
    GraphBuilder.CreateBuffer(Desc, TEXT("ElementBuffer"));

FRDGBufferSRVRef ElementSRV =
    GraphBuilder.CreateSRV(ElementBuffer, PF_Unknown);
```

若 Shader 需要写入，则增加 `UnorderedAccess` usage，并创建 UAV：

```cpp
Desc.Usage |= EBufferUsageFlags::UnorderedAccess;

FRDGBufferUAVRef ElementUAV =
    GraphBuilder.CreateUAV(ElementBuffer, PF_Unknown);
```

### 3.4 越界与长度

资源长度由运行时绑定的 View 决定，Shader 编译器通常不知道实际元素数量。因此即使只创建了 3 个元素，下面的代码一般仍能通过编译：

```hlsl
FElement Value = Elements[3]; // 有效索引只有 0、1、2
```

越界读取在不同图形 API、绑定方式和硬件上的行为并不完全一致，不应依赖“返回 0”或“读到某段脏数据”。应传入有效数量，或者查询 View 维度：

```hlsl
uint ElementCount;
uint ElementStride;
Elements.GetDimensions(ElementCount, ElementStride);

if (Index < ElementCount)
{
    FElement Value = Elements[Index];
}
```

### 3.5 特点与适用场景

- 适合概念上就是 `T[]` 的数据。
- `T` 可以是标量、向量或自定义结构。
- 字段语义清晰，Shader 自动完成 `i × stride` 寻址。
- 不提供 UNORM、SNORM 等 Typed Format 自动转换。
- 常用于粒子、实例、灯光、骨骼和自定义记录数组。

---

## 4. ByteAddressBuffer：按字节地址访问

### 4.1 模型

```hlsl
ByteAddressBuffer RawData;
RWByteAddressBuffer RawOutput;
```

ByteAddress Buffer 又称 Raw Buffer。它不定义统一的元素类型或 stride，Shader 直接传入字节偏移：

```text
读取地址 = View 起始地址 + ByteOffset
```

在经典接口中，地址应保持 4 字节对齐。

### 4.2 Load 与 Store

```hlsl
uint  A = RawData.Load(Address);   // 读取  4 字节
uint2 B = RawData.Load2(Address);  // 读取  8 字节
uint3 C = RawData.Load3(Address);  // 读取 12 字节
uint4 D = RawData.Load4(Address);  // 读取 16 字节
```

`Load2/Load3/Load4` 是 HLSL 内置成员函数，分别返回连续的 2、3、4 个 32 位 word。它们不会维护读取游标；下一项地址仍需 Shader 自己计算。

`RWByteAddressBuffer` 使用对应的 `Store/Store2/Store3/Store4` 写入：

```hlsl
RawOutput.Store(ByteOffset, ValueBits);
```

### 4.3 自定义布局

Raw Buffer 可以保存不同类型的数据区，但不会记录字段名称或类型。CPU 和 Shader 必须共享同一份字节协议，例如：

```text
字节  0..3  ：uint   ElementCount
字节  4..7  ：float  Scale
字节  8..19 ：float3 Direction
字节 20..23 ：uint   Flags
```

Shader 按协议读取：

```hlsl
uint ElementCount = RawData.Load(0);
float Scale       = asfloat(RawData.Load(4));
float3 Direction  = asfloat(RawData.Load3(8));
uint Flags        = RawData.Load(20);
```

如果数据是大量固定且重复的相同结构，通常应优先使用 `StructuredBuffer<T>`。Raw 更适合动态分区、变长记录、地址表或自定义压缩布局。

### 4.4 数值转换与位重解释

`Load*` 返回 `uint` 位模式。普通 cast 会转换数值，`as*` 则保持 bit 不变，只改变解释方式：

```hlsl
uint Bits = RawData.Load(0);

float Converted     = (float)Bits; // uint 数值转换为 float 数值
float Reinterpreted = asfloat(Bits); // 相同 32 bit 按 float 解释
```

以 `1.0f` 为例：

```text
0x3F800000

二进制：
00111111 10000000 00000000 00000000

按 IEEE 754 float 拆分：
0 | 01111111 | 00000000000000000000000
↑      ↑                 ↑
符号位  指数               尾数
```

```text
数值 = (-1)^Sign × 2^(Exponent - 127) × (1 + Fraction)
     = (-1)^0 × 2^(127 - 127) × 1
     = 1.0
```

同一个 `0x3F800000`：

```text
按 uint 解释  → 1065353216
按 float 解释 → 1.0
```

常用的 32 位重解释函数：

```hlsl
asfloat(Bits) // int/uint 位模式 → float
asuint(Value) // float/int 位模式 → uint
asint(Bits)   // float/uint 位模式 → int
```

其他常见操作：

```hlsl
f16tof32(HalfBits) // float16 位模式转换为 float32
f32tof16(Value)    // float32 转换为 float16 位模式
```

`uint8`、`uint16`、UNORM 或位字段通常先按 32 位读取，再使用位移、mask 和缩放解包。

### 4.5 UE RDG 创建方式

```cpp
FRDGBufferDesc Desc =
    FRDGBufferDesc::CreateByteAddressDesc(TotalByteSize);

Desc.Usage |= EBufferUsageFlags::ShaderResource;

FRDGBufferRef RawBuffer =
    GraphBuilder.CreateBuffer(Desc, TEXT("RawBuffer"));

FRDGBufferSRVRef RawSRV =
    GraphBuilder.CreateSRV(RawBuffer, PF_R32_UINT);
```

`CreateByteAddressDesc` 接收总字节数，不接收“元素大小 + 元素数量”。UE 创建 Raw View 时可能使用 `PF_R32_UINT` 作为 RHI 层参数，但这不会把 HLSL 中的 Raw Buffer 变成具有固定语义的 `uint[]`。

### 4.6 特点与适用场景

- 布局最灵活，但类型安全最低。
- 适合自定义压缩、位字段、变长记录和异构数据区。
- 适合间接参数、计数器、地址表和通用内存算法。
- Shader 必须自行维护偏移、对齐、边界和位解释。
- 灵活不等于更快；规则结构数组通常优先使用 Structured。

---

## 5. Buffer<T>：按 View Format 解释

### 5.1 模型

```hlsl
Buffer<float4> InputData;
RWBuffer<float4> OutputData;
```

`Buffer<T>` 通常称为 Typed Buffer。它是一维元素数组，元素大小和存储格式由 SRV/UAV 的 View Format 决定：

```text
第 i 项地址 = View 起始地址 + i × FormatByteSize
读取结果 = 按 View Format 解码并转换为 HLSL 的 T
```

### 5.2 读取方式与格式转换

```hlsl
float4 Value = InputData[Index];
```

Typed Buffer 的重点不是自定义结构，而是标准 GPU 格式。例如，底层使用四个 8 位 UNORM 通道时，Shader 可以直接得到 `[0, 1]` 范围的 `float4`，无需手工执行 mask 和除以 255。

View Format、HLSL 的 `T`、分量数量和数值类别必须兼容。整数格式通常对应 `Buffer<uint...>` 或 `Buffer<int...>`，浮点和归一化格式通常对应 `Buffer<float...>`。

### 5.3 UE RDG 创建方式

```cpp
FRDGBufferDesc Desc =
    FRDGBufferDesc::CreateBufferDesc(
        sizeof(FVector4f),
        ElementCount);

Desc.Usage |= EBufferUsageFlags::ShaderResource;

FRDGBufferRef TypedBuffer =
    GraphBuilder.CreateBuffer(Desc, TEXT("TypedBuffer"));

FRDGBufferSRVRef TypedSRV =
    GraphBuilder.CreateSRV(
        TypedBuffer,
        PF_A32B32G32R32F);
```

`CreateBufferDesc` 确定分配大小，`PF_A32B32G32R32F` 则规定 View 中每项是 4 个 32 位浮点分量，共 16 字节，与 `Buffer<float4>` 对应。

### 5.4 常见格式示例

| UE Pixel Format | 单项存储 | 常见 HLSL 声明 | 读取语义 |
|---|---:|---|---|
| `PF_R32_FLOAT` | 4 字节 | `Buffer<float>` | 单个 32 位浮点数 |
| `PF_R32_UINT` | 4 字节 | `Buffer<uint>` | 单个 32 位无符号整数 |
| `PF_R32_SINT` | 4 字节 | `Buffer<int>` | 单个 32 位有符号整数 |
| `PF_G32R32F` | 8 字节 | `Buffer<float2>` | 两个 32 位浮点分量 |
| `PF_A32B32G32R32F` | 16 字节 | `Buffer<float4>` | 四个 32 位浮点分量 |
| `PF_R16F` | 2 字节 | `Buffer<float>` | 16 位浮点存储，读取为 float |
| `PF_FloatRGBA` | 8 字节 | `Buffer<float4>` | 四个 16 位浮点分量 |
| `PF_R8G8B8A8` | 4 字节 | `Buffer<float4>` | 四个 8 位 UNORM 分量 |

具体格式能否用于 Buffer SRV 或 Typed UAV，以及通道映射方式，应以目标 RHI 和硬件能力为准。Typed UAV 的格式支持通常比只读 SRV 更严格。

### 5.5 特点与适用场景

- 适合能由标准 GPU format 表达的标量或短向量数组。
- 可利用 UNORM、SNORM、整数和浮点格式转换。
- 可用较小格式降低内存和带宽。
- 不适合包含任意成员的自定义结构。
- 虽然使用像素格式，但它仍是一维 Buffer，没有 mip、过滤和常规纹理采样语义。

---

## 6. RW 增加了什么

无 `RW` 的资源绑定 SRV，只允许 Shader 读取；带 `RW` 的资源绑定 UAV，允许 Shader 读取和写入：

| 只读 SRV | 可读写 UAV |
|---|---|
| `StructuredBuffer<T>` | `RWStructuredBuffer<T>` |
| `Buffer<T>` | `RWBuffer<T>` |
| `ByteAddressBuffer` | `RWByteAddressBuffer` |

UE 参数声明也必须匹配：

```cpp
SHADER_PARAMETER_RDG_BUFFER_SRV(StructuredBuffer<FElement>, InputData)
SHADER_PARAMETER_RDG_BUFFER_UAV(RWStructuredBuffer<FElement>, OutputData)
```

底层资源若要创建 UAV，还必须包含 `EBufferUsageFlags::UnorderedAccess`。

`RW` 只表示 Shader 具有 UAV 写权限，不表示 CPU 可以直接访问显存，也不提供自动的线程排队、写后可见性或越界保护。CPU 访问通常需要 upload/readback/copy；多个线程更新同一地址需要独占索引或原子操作；跨线程和跨 Pass 的读写依赖需要正确的 barrier、资源状态和同步。

将只读与可写资源分开，使编译器、RHI 和渲染图能够识别资源 hazard，安排状态转换，并判断哪些访问可以并行。因此 `RW` 同时属于权限、同步和性能契约。

---

## 7. cbuffer：少量只读常量参数

### 7.1 模型与目的

```hlsl
cbuffer DrawConstants
{
    float4 Tint;
    float3 Direction;
    float Time;
    float Radius;
    float3 Padding;
};
```

`cbuffer` 用于向一次 Draw 或 Dispatch 提供少量只读参数。Shader 按成员名访问，不把它当作大型元素数组：

```hlsl
float3 ScaledDirection = Direction * Radius;
```

“Constant” 表示 Shader 在当前 Draw/Dispatch 中不能修改它，不表示该数据是编译期常量。CPU 可以在下一次执行前绑定另一份数据。

### 7.2 布局

cbuffer 主要按照 16 字节常量寄存器行打包。标量和向量可以共享一行，但不能跨越 16 字节边界：

```text
Tint              ：16 字节
Direction + Time  ：12 + 4 字节
Radius + Padding  ： 4 + 12 字节
总计              ：48 字节
```

这套规则与 Structured Buffer 的 stride 布局不同。数组、矩阵和嵌套结构还会引入额外打包规则，因此 CPU 与 HLSL 两端仍需使用一致的成员顺序、位宽和 padding。

### 7.3 UE 创建与绑定

```cpp
BEGIN_GLOBAL_SHADER_PARAMETER_STRUCT(FDrawConstants, )
    SHADER_PARAMETER(FVector4f, Tint)
    SHADER_PARAMETER(FVector3f, Direction)
    SHADER_PARAMETER(float, Time)
    SHADER_PARAMETER(float, Radius)
    SHADER_PARAMETER(FVector3f, Padding)
END_GLOBAL_SHADER_PARAMETER_STRUCT()

IMPLEMENT_GLOBAL_SHADER_PARAMETER_STRUCT(
    FDrawConstants,
    "DrawConstants");
```

外层 Shader 参数持有 Uniform Buffer 引用：

```cpp
SHADER_PARAMETER_STRUCT_REF(FDrawConstants, DrawConstants)
```

创建并绑定实际数据：

```cpp
FDrawConstants Data;
Data.Tint = Tint;
Data.Direction = Direction;
Data.Time = Time;
Data.Radius = Radius;
Data.Padding = FVector3f::ZeroVector;

TUniformBufferRef<FDrawConstants> UniformBuffer =
    TUniformBufferRef<FDrawConstants>::CreateUniformBufferImmediate(
        Data,
        UniformBuffer_SingleDraw);

PassParameters->DrawConstants = UniformBuffer;
```

`cbuffer` 不通过 `CreateSRV/CreateUAV` 绑定，也不需要 `PF_*` 格式；它使用 Uniform Buffer/CBV 类别的参数路径。

### 7.4 cbuffer 的优势

- 将相关常量组织成具有明确布局和生命周期的参数块。
- 可以按 PerFrame、PerView、PerMaterial、PerDraw 等更新频率拆分。
- 同一份 Uniform Buffer 可以被多个 Shader Stage 或 Pass 复用。
- 明确表达“少量、只读、通常被大量线程共同消费”的访问意图。
- 便于引擎、驱动和硬件采用适合统一常量的绑定与缓存策略。

少量散装参数也可能被 UE 或编译器打包为常量数据，因此显式 cbuffer 不保证仅凭语法就更快。它最明显的价值是分组、复用、稳定布局和独立更新。

### 7.5 cbuffer 与 StructuredBuffer<T> 的选择

下面的写法在技术上可以保存一组参数：

```hlsl
StructuredBuffer<FParameters> ParameterArray;
FParameters Parameters = ParameterArray[0];
```

但它表达的是“包含 N 个元素的数据数组”。如果所有线程读取同一组小型参数，`cbuffer` 更符合语义；如果 Shader 需要根据索引读取许多不同记录，则应使用 `StructuredBuffer<T>`。

最终选择可以概括为：

```text
少量、统一、只读的执行参数          → cbuffer
规则的自定义结构数组                → StructuredBuffer<T>
标准格式标量/向量及自动格式转换      → Buffer<T>
动态、异构、压缩或自定义字节协议      → ByteAddressBuffer
Shader 需要写入上述资源              → 对应的 RW* 类型与 UAV
```
