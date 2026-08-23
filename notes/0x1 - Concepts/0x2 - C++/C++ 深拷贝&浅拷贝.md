---
title: "C++ 深拷贝&浅拷贝"
date: "2026-08-11"
summary: "对比 C++ 浅拷贝与深拷贝对指针和堆内存的处理差异，并说明拷贝构造、赋值运算符及资源管理要点。"
category: "C++"
tags:
  - "C++"
  - "深拷贝"
  - "浅拷贝"
  - "拷贝构造函数"
  - "赋值运算符"
  - "RAII"
---

在 C++ 中，**浅拷贝（Shallow Copy）**和**深拷贝（Deep Copy）**的核心区别在于**对指针和堆内存资源的处理方式**。

## 1. 核心概念与内存布局

### 浅拷贝（Shallow Copy）

* **定义**：按字节直接复制对象的所有成员变量（C++ 默认的拷贝构造函数和赋值运算符采用的就是浅拷贝）。
* **对指针的处理**：只复制指针**存储的地址值**，而不复制指针所指向的**堆内存数据**。
* **后果**：两个对象的指针成员指向**同一块堆内存**。
* **相互干扰**：修改一个对象的数据，另一个也会跟着变。
* **程序崩溃（Double Free）**：当两个对象生命周期结束调用析构函数时，会对同一块内存 `delete` 两次，直接导致程序崩溃。

<svg xmlns="http://www.w3.org/2000/svg" width="538" height="323" viewBox="30 86 538 323" role="img" aria-labelledby="title desc">
  <title id="title">内存示意图：浅拷贝</title>
  <desc id="desc">对象 a 和对象 b 指向同一块堆内存，析构时重复释放会导致崩溃。</desc>

  <defs>
    <style>
      .mono { font-family: Consolas, "SFMono-Regular", "Microsoft YaHei", monospace; fill: #000; }
      .label { font-size: 15px; font-weight: 700; }
      .body { font-size: 14px; font-weight: 700; }
      .heading { font-size: 16px; font-weight: 700; }
      .line { fill: none; stroke: #000; stroke-width: 2; stroke-linecap: square; stroke-linejoin: miter; }
      .dash { stroke-dasharray: 15 4; }
    </style>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L8,4 L0,8 Z" fill="#000"/>
    </marker>
  </defs>

  <!-- Column headings -->
  <text class="mono heading" x="95" y="117">栈内存（Stack）</text>
  <text class="mono heading" x="415" y="117">堆内存（Heap）</text>

  <!-- Stack object a -->
  <g id="stack-object-a">
    <rect class="line dash" x="46" y="133" width="218" height="84"/>
    <text class="mono body" x="66" y="159">对象 a</text>
    <text class="mono body" x="84" y="180">size: 3</text>
    <text class="mono body" x="84" y="201">data: 0x7FFF00</text>
  </g>

  <!-- Shared heap allocation -->
  <g id="shared-heap-allocation">
    <rect class="line dash" x="390" y="133" width="160" height="189"/>
    <text class="mono body" x="412" y="220">[1, 2, 3]</text>
    <text class="mono body" x="412" y="241">(地址: 0x7FFF00)</text>
  </g>
  <path class="line" d="M209 196 H384" marker-end="url(#arrow)"/>

  <!-- Stack object b -->
  <g id="stack-object-b">
    <rect class="line dash" x="46" y="259" width="218" height="84"/>
    <text class="mono body" x="66" y="285">对象 b（a 的浅拷贝）</text>
    <text class="mono body" x="84" y="306">size: 3</text>
    <text class="mono body" x="84" y="327">data: 0x7FFF00</text>
  </g>
  <path class="line" d="M209 322 H384" marker-end="url(#arrow)"/>

  <!-- Explanatory note -->
  <path d="M407 337 L401 346 H413 Z" fill="#000"/>
  <text class="mono body" text-anchor="middle" x="408" y="368">（同一块内存，析构时</text>
  <text class="mono body" text-anchor="middle" x="408" y="390">重复 delete 导致崩溃）</text>
</svg>

### 深拷贝（Deep Copy）

* **定义**：不仅复制对象本身，还会为新对象的指针成员**重新开辟一块独立的堆内存**，并将原内存中的数据完整复制过去。
* **对指针的处理**：创建全新的内存空间，拷贝数据内容，产生全新的指针地址。实现时需同时重载**拷贝构造函数**与**拷贝赋值运算符**（后者需特别注意防自我赋值与释放旧内存）。
* **后果**：两个对象**完全独立**，各自管理自己的内存，互不影响，析构时各自释放独立的内存。

<svg xmlns="http://www.w3.org/2000/svg" width="537" height="324" viewBox="36 71 537 324" role="img" aria-labelledby="title desc">
  <title id="title">内存示意图：深拷贝</title>
  <desc id="desc">对象 a 和对象 b 分别指向两块独立堆内存。</desc>

  <defs>
    <style>
      .mono { font-family: Consolas, "SFMono-Regular", "Microsoft YaHei", monospace; fill: #000; }
      .label { font-size: 15px; font-weight: 700; }
      .body { font-size: 14px; font-weight: 700; }
      .heading { font-size: 16px; font-weight: 700; }
      .line { fill: none; stroke: #000; stroke-width: 2; stroke-linecap: square; stroke-linejoin: miter; }
      .dash { stroke-dasharray: 15 4; }
    </style>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L8,4 L0,8 Z" fill="#000"/>
    </marker>
  </defs>

  <!-- Column headings -->
  <text class="mono heading" x="100" y="101">栈内存（Stack）</text>
  <text class="mono heading" x="420" y="101">堆内存（Heap）</text>

  <!-- Stack object a -->
  <g id="stack-object-a">
    <rect class="line dash" x="52" y="117" width="218" height="83"/>
    <text class="mono body" x="72" y="143">对象 a</text>
    <text class="mono body" x="90" y="164">size: 3</text>
    <text class="mono body" x="90" y="184">data: 0x7FFF00</text>
  </g>

  <!-- First heap allocation -->
  <g id="heap-allocation-a">
    <rect class="line dash" x="396" y="117" width="161" height="63"/>
    <text class="mono body" x="413" y="143">[1, 2, 3]</text>
    <text class="mono body" x="420" y="164">(地址: 0x7FFF00)</text>
  </g>
  <path class="line" d="M214 180 H390" marker-end="url(#arrow)"/>

  <!-- Stack object b -->
  <g id="stack-object-b">
    <rect class="line dash" x="52" y="243" width="218" height="83"/>
    <text class="mono body" x="72" y="269">对象 b（a 的深拷贝）</text>
    <text class="mono body" x="90" y="290">size: 3</text>
    <text class="mono body" x="90" y="311">data: 0x8AAA11</text>
  </g>

  <!-- Independent heap allocation -->
  <g id="heap-allocation-b">
    <rect class="line dash" x="396" y="243" width="161" height="63"/>
    <text class="mono body" x="413" y="270">[1, 2, 3]</text>
    <text class="mono body" x="420" y="291">(地址: 0x8AAA11)</text>
  </g>
  <path class="line" d="M214 306 H390" marker-end="url(#arrow)"/>

  <!-- Explanatory note -->
  <path d="M413 321 L407 329 H419 Z" fill="#000"/>
  <text class="mono body" text-anchor="middle" x="413" y="353">（全新的堆内存，</text>
  <text class="mono body" text-anchor="middle" x="413" y="375">各自独立释放）</text>
</svg>

## 2. 代码示例

以下代码展示了与上述内存图示对应的 `MyArray` 类实现：

```cpp
#include <iostream>

class MyArray {
private:
    int* data;
    int size;

public:
    // 构造函数：在堆上分配内存
    MyArray(int s) : size(s) {
        data = new int[size];
        for (int i = 0; i < size; ++i) data[i] = i + 1; // 填充 [1, 2, 3]
    }

    // -------------------------------------------------------------
    // 浅拷贝构造与赋值（若使用默认实现，仅按字节复制栈上的地址）
    // MyArray(const MyArray& other) : size(other.size), data(other.data) {}
    //【浅拷贝触发条件】：若注释掉下面的深拷贝构造函数，编译器会自动生成默认拷贝构造（浅拷贝）
    // -------------------------------------------------------------

    // 深拷贝构造函数（初始化新对象：开辟新堆内存）
    MyArray(const MyArray& other) : size(other.size) {
        data = new int[size]; // ① 在堆上开辟独立新内存 (例如 0x8AAA11)
        for (int i = 0; i < size; ++i) {
            data[i] = other.data[i]; // ② 复制数据内容
        }
    }

    // 深拷贝赋值运算符（已存在对象的赋值：释放旧内存 + 开辟新内存）
    MyArray& operator=(const MyArray& other) {
        if (this == &other) return *this; // ① 防止自我赋值 (a = a)

        delete[] data;                    // ② 释放当前对象旧堆内存

        size = other.size;
        data = new int[size];             // ③ 重新开辟堆内存并复制
        for (int i = 0; i < size; ++i) {
            data[i] = other.data[i];
        }

        return *this;                     // ④ 返回引用支持链式赋值
    }

    // 析构函数：释放堆内存
    ~MyArray() {
        delete[] data; // 浅拷贝会导致对同一个 0x7FFF00 地址 delete 两次
    }
};

int main() {
    MyArray a(3);

    // 1. 深拷贝演示
    MyArray b = a; // 调用自定义深拷贝构造
    std::cout << "【深拷贝】a.data 地址: " << a.data << std::endl;
    std::cout << "【深拷贝】b.data 地址: " << b.data << std::endl;
    // 结果：地址不同（如 0x7FFF00 与 0x8AAA11），各自安全析构

    /* 
    // 2. 浅拷贝对比测试（若想看浅拷贝效果，将类中的“深拷贝构造函数”注释掉即可）：
    MyArray c = a; // 此时调用编译器生成的默认浅拷贝
    std::cout << "【浅拷贝】a.data 地址: " << a.data << std::endl;
    std::cout << "【浅拷贝】c.data 地址: " << c.data << std::endl;
    // 结果：地址完全相同（均为 0x7FFF00）
    // 运行结果：程序会在 return 0 退出时崩溃，提示 Double Free（二次释放相同内存）
    */

    return 0;
}

```


## 3. 两种拷贝方式对比

| 特性 | 浅拷贝（Shallow Copy） | 深拷贝（Deep Copy） |
| --- | --- | --- |
| **内存处理** | 仅复制栈上的指针地址，共享同一块堆内存 | 在堆上重新分配内存，各自拥有独立副本 |
| **数据影响** | 修改 A 会直接影响 B | 修改 A 完全不影响 B |
| **析构安全性** | 极易引发 **Double Free（二次释放）** 崩溃 | 内存安全，各自独立释放 |
| **实现关键** | 编译器默认生成 | 手写拷贝构造与赋值运算符（**注意：防自我赋值 + 释放旧资源**） |

> **现代 C++ 最佳实践**：在实际开发中，应尽量使用 `std::vector`、`std::string` 或智能指针（如 `std::unique_ptr` / `std::shared_ptr`）来自动管理资源，遵循 **RAII 机制**，从而避免手写深拷贝和繁重的数据管理。

---

> **浅拷贝是“复制钥匙”（两人共用一间房，一人退房锁就坏）；深拷贝是“按样造房”（各自拥有独立房间，改动退房互不影响）。**
