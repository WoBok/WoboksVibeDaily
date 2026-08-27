---
title: "C++ 左值、右值与移动语义"
date: "2026-08-26"
summary: "解析 C++ 左值、亡值与纯右值的分类和引用绑定规则，以及移动构造、std::move 与 std::forward 的作用。"
category: "C++"
tags:
  - "C++"
  - "值类别"
  - "移动语义"
  - "右值引用"
  - "std::move"
  - "std::forward"
---

在 C++ 中，**左值与右值是表达式的属性**，不是对象的存储位置，也与对象位于栈上还是堆上无关。

值类别决定表达式能绑定到哪种引用，进而影响重载选择，以及最终发生拷贝还是移动：

> **值类别 → 引用绑定 → 重载选择 → 拷贝或移动**

---

## 1. 值类别

C++11 主要从两个维度划分表达式：

- **有身份（Identity）**：指向一个可识别、可区分的实体。
- **可移动（Movable）**：其资源允许被转移。

由此得到三种基础值类别：

| 类别 | 有身份 | 可移动 | 典型示例 |
| --- | --- | --- | --- |
| **左值（lvalue）** | 是 | 否 | 变量名 `a`、解引用 `*p`、返回左值引用的表达式 |
| **亡值（xvalue）** | 是 | 是 | `std::move(a)`、`static_cast<T&&>(a)` |
| **纯右值（prvalue）** | 否 | 是 | 字面量 `42`、`a + b`、返回非引用类型的函数调用 |

它们还可组合为两类：

```text
泛左值（glvalue）= 左值（lvalue）+ 亡值（xvalue）  // 有身份
右值（rvalue）   = 亡值（xvalue）+ 纯右值（prvalue）// 可移动
```

亡值同时属于泛左值和右值：它有明确身份，但资源可以被转移。

```cpp
int a = 10;                     // a：左值；10：纯右值
int b = a + 5;                  // b：左值；a + 5：纯右值
std::string s = "hello";
std::string t = std::move(s);   // std::move(s)：亡值
```

通常只有左值能直接作为内置取地址运算符 `&` 的操作数。亡值虽然有身份，但不能直接取地址。

## 2. 引用绑定与重载

基本绑定规则如下：

| 引用类型 | 可绑定的表达式 |
| --- | --- |
| `T&` | 非 `const` 左值 |
| `const T&` | 左值和右值 |
| `T&&` | 右值（纯右值或亡值） |

因此，同一个对象可以因表达式的值类别不同而选择不同重载：

```cpp
void use(const std::string&); // 拷贝式处理
void use(std::string&&);      // 移动式处理

std::string s = "hello";
use(s);                       // s 是左值，选择 const T&
use(std::move(s));            // std::move(s) 是亡值，选择 T&&
```

### 具名右值引用是左值

右值引用变量的**类型**是 `T&&`，但它一旦有名字，作为表达式就是左值：

```cpp
void relay(std::string&& s) {
    use(s);                   // s 是左值
    use(std::move(s));        // 转为亡值，允许继续移动
}
```

## 3. 为什么需要移动语义

C++98 主要依赖深拷贝。对于持有大块动态资源的对象，复制临时对象需要重新分配内存并复制全部内容，随后临时对象又会被销毁，开销较大。

C++11 引入**右值引用、移动构造和移动赋值**。当源对象的资源不再需要保留时，新对象可以直接接管其资源。以动态数组为例，深拷贝通常是 $O(N)$，转移指针则通常是 $O(1)$。

下面的示例保留了拷贝与移动的核心差异：

```cpp
#include <algorithm>
#include <cstddef>
#include <utility>

class DynamicBuffer {
public:
    explicit DynamicBuffer(std::size_t n = 0)
        : data_(n ? new int[n]() : nullptr), size_(n) {}

    // 拷贝：分配新内存并复制数据
    DynamicBuffer(const DynamicBuffer& other)
        : DynamicBuffer(other.size_) {
        if (size_ != 0) std::copy_n(other.data_, size_, data_);
    }

    // 移动：接管资源，并将源对象置于可析构状态
    DynamicBuffer(DynamicBuffer&& other) noexcept
        : data_(std::exchange(other.data_, nullptr)),
          size_(std::exchange(other.size_, 0)) {}

    // 拷贝赋值：先复制，再交换
    DynamicBuffer& operator=(const DynamicBuffer& other) {
        if (this != &other) {
            DynamicBuffer temp(other);
            swap(temp);
        }
        return *this;
    }

    // 移动赋值：释放原资源，再接管新资源
    DynamicBuffer& operator=(DynamicBuffer&& other) noexcept {
        if (this != &other) {
            delete[] data_;
            data_ = std::exchange(other.data_, nullptr);
            size_ = std::exchange(other.size_, 0);
        }
        return *this;
    }

    ~DynamicBuffer() { delete[] data_; }

private:
    void swap(DynamicBuffer& other) noexcept {
        std::swap(data_, other.data_);
        std::swap(size_, other.size_);
    }

    int* data_ = nullptr;
    std::size_t size_ = 0;
};
```

```cpp
DynamicBuffer buf1(1024);
DynamicBuffer buf2 = buf1;             // 拷贝构造：深拷贝，持有独立内存
DynamicBuffer buf3 = std::move(buf1);  // 移动构造：buf3 接管指针，buf1 被置空

std::move(buf1);                       // 仅为类型转换，无接收者，不产生任何效果

std::cout << (buf1.data ? "holding data" : "null") << '\n';  // null（资源已移出）
std::cout << (buf2.data ? "holding data" : "null") << '\n';  // holding data（独立副本）
std::cout << (buf3.data ? "holding data" : "null") << '\n';  // holding data（已接管资源）
```

## 4. `std::move` 与 `std::forward`

### `std::move`：无条件转为亡值

`std::move` 本身不移动任何数据，也没有运行时开销。它只是将表达式无条件转换为亡值，使其能够匹配移动重载：

```cpp
template <class T>
constexpr std::remove_reference_t<T>&& move(T&& value) noexcept {
    return static_cast<std::remove_reference_t<T>&&>(value);
}
```

因此，`std::move(a)` 只表示“允许转移 `a` 的资源”。是否真正发生移动，取决于接收方是否提供并选中了移动重载。

### `std::forward`：保留实参原有值类别

`std::forward` 主要用于模板中的**转发引用**。它使左值仍以左值传递，使右值仍以右值传递：

```cpp
template <class T>
void relay(T&& value) {
    use(std::forward<T>(value));
}
```

简而言之：

- `std::move`：无条件允许移动。
- `std::forward`：按实参原本的值类别传递。

## 5. 使用要点

### `const` 对象通常不能移动

移动需要修改源对象。`const T` 不能绑定到常见移动构造的 `T&&`，因此通常会退化为拷贝：

```cpp
const std::string s = "hello";
std::string t = std::move(s);   // 通常调用拷贝构造
```

### 直接返回局部对象

直接返回可使用 NRVO 或隐式移动；添加 `std::move` 反而可能阻止 NRVO：

```cpp
T make() {
    T value;
    return value;               // 推荐
}
```

### 移后对象仍然有效

移后对象可安全析构或重新赋值，但其状态通常未指定，不能假定它一定为空。

### 移动构造应标记 `noexcept`

否则，`std::vector` 等容器为保证异常安全，扩容时可能退回拷贝。

## 6. 核心总结

- **左值**：有身份，通常表示仍会继续使用的对象。
- **纯右值**：无身份，通常是用于计算或初始化的临时结果。
- **亡值**：有身份，但资源已被允许转移。
- **右值引用**让程序能够区分“需要保留的对象”和“可转移资源的对象”。
- **`std::move` 不执行移动，只是允许移动；真正的移动由移动构造或移动赋值完成。**

理解移动语义的关键不是死记“左边还是右边”：

> 这个表达式是否指向一个有身份的实体？它的资源是否允许被转移？
