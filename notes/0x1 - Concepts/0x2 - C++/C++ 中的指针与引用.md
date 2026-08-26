---
title: "C++ 中的指针与引用"
date: "2026-08-26"
summary: "梳理 C++ 指针与引用的语义、声明和访问方式，并对比左值引用、右值引用、转发引用及 const 限制。"
category: "C++"
tags:
  - "C++"
  - "指针"
  - "引用"
  - "右值引用"
  - "转发引用"
  - "const"
---

## 一、指针与引用的核心

### 1. 指针：保存对象的地址

指针保存对象所在的地址；指针类型决定如何解释该地址中的数据。

```cpp
#include <cstdint>
#include <iostream>

int value = 42;
int* ptr = &value;  // ptr 保存 value 的地址

std::uintptr_t address =
    reinterpret_cast<std::uintptr_t>(&ptr);

std::cout
    << **reinterpret_cast<int**>(address)
    << '\n';  // 输出 42
```

地址关系为：

```text
address → ptr → value → 42
```

第一次解引用得到 `ptr`，第二次解引用得到 `value`。将地址转换成整数只是为了展示地址关系，实际代码通常直接使用指针。

### 2. 引用：对象的另一个名字

引用是已有对象的别名。操作引用，就是直接操作原对象。

```cpp
int value = 42;
int& ref = value;

ref = 100;

std::cout << value << '\n';        // 输出 100
std::cout << (&ref == &value);     // 输出 1
```

引用必须在声明时绑定，之后不能改绑。

### 3. 指针与引用访问对象的区别

```cpp
struct Data {
    int number{};
    float value{};
};

Data data;

// 使用指针访问对象
Data* dataPtr = &data;

dataPtr->number = 10;       // 等价于 (*dataPtr).number = 10
(*dataPtr).value = 20.0f;   // 等价于 dataPtr->value = 20.0f

std::cout << dataPtr->number << '\n'; // 输出 10
std::cout << dataPtr->value << '\n';  // 输出 20

// 使用引用访问同一个对象
Data& dataRef = *dataPtr;

dataRef.number = 30;
dataRef.value = 40.0f;

std::cout << dataRef.number << '\n'; // 输出 30
std::cout << dataRef.value << '\n';  // 输出 40
```

二者访问的是同一个 `data` 对象，区别在于语法：

- 指针使用 `dataPtr->member`，等价于 `(*dataPtr).member`。
- 引用像普通对象一样，直接使用 `dataRef.member`。

> 指针表示“对象在哪里”，引用表示“这个对象也可以叫这个名字”。

## 二、指针、引用与操作符的语法形式

```cpp
#include <utility>

int value = 42;  // 普通 int 变量；表达式 value 是左值

// 1. 指针：* 出现在声明中
int* ptr = &value;              // ptr 是指向 int 的指针
int** pptr = &ptr;              // pptr 是二级指针，指向指针 ptr
const int* cp = &value;         // cp 可改指向，但不能通过 cp 修改所指对象
int* const pc = &value;         // pc 不可改指向，但可以通过 pc 修改所指对象
void (*funcPtr)(int) = nullptr; // 指向“参数为 int、返回 void”的函数的指针

// const int* 不会让原对象变成常量
// *cp = 10;                    // 错误：不能通过 cp 修改
value = 10;                     // 正确：value 本身仍是普通变量

// 2. 引用：& 或 && 出现在声明中
int& ref = value;          // 左值引用：value 的别名
const int& cref = 100;     // 常量左值引用：可绑定临时值，只读
int&& rref = 100;          // 右值引用：绑定临时值并延长其生命周期
auto&& uref = value;       // 转发引用：value 是左值，最终推导为 int&

// 有名字的右值引用，在表达式中是左值
rref = 200;                    // 正确：可以直接修改
int&& rref2 = std::move(rref); // std::move 将 rref 转换为右值

// 3. 表达式中的操作符
int* p = &value;           // &：取地址
*ptr = 20;                 // *：解引用，修改所指对象
int num = *ptr;            // *：解引用，读取所指对象
int* pSame = &*ptr;        // ptr 有效时，结果与 ptr 相同
```

`const int*` 限制的是“不能通过该指针修改对象”，并不会使原对象变成常量。

`rref` 的声明类型是 `int&&`，但表达式 `rref` 是左值。`std::move` 本身不移动对象，只负责将表达式转换为右值。

## 三、核心对比

| 形式 | 声明示例 | 初始化与绑定 | 能否改绑或为空 | 使用方式 |
| --- | --- | --- | --- | --- |
| **指针 `*`** | `int* ptr` | 保存对象地址，建议初始化为有效地址或 `nullptr` | 可改指向，可为空 | `&value` 取地址，`*ptr` 访问对象 |
| **左值引用 `&`** | `int& ref = value` | 必须初始化，绑定左值 | 不可改绑，正常情况下不为空 | 直接通过 `ref` 读写 |
| **常量左值引用 `const &`** | `const int& ref = 10` | 可绑定左值或临时值 | 不可改绑，只读 | 直接通过 `ref` 读取 |
| **右值引用 `&&`** | `int&& ref = 10` | 通常绑定临时值 | 不可改绑 | 命名后是左值，可用 `std::move` 转为右值 |
| **转发引用 `auto&&` / `T&&`** | `auto&& ref = expr` | 根据 `expr` 的值类别推导 | 不可改绑 | 保持并转发表达式的值类别 |

---

> 指针保存对象的地址，引用是对象的别名。声明中，`T*` 表示指针，`T&` 表示左值引用，`T&&` 表示右值引用或转发引用；表达式中，`&obj` 取地址，`*ptr` 访问所指对象。
