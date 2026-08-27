---
title: "C++ const 核心要点"
date: "2026-08-27"
summary: "系统梳理 C++ const 在变量、指针引用、函数、类与类型转换中的语义，并对比 constexpr、consteval 和 constinit。"
category: "C++"
tags:
  - "C++"
  - "const"
  - "常量成员函数"
  - "类型系统"
  - "常量求值"
---

`const` 在 C++ 中用于表达**只读访问约束**。它的核心作用是向编译器和开发者承诺:"该数据或状态在此处只读",编译器会在编译期进行类型检查,阻止任何非法修改。

---

### 1. 基础变量与常量

修饰标量类型变量时,该变量必须在定义时初始化,且后续不可修改。

```cpp
const int MAX_USERS = 100;
// MAX_USERS = 200; // 编译错误
```

> **注意：** 在 C++ 中，全局/命名空间域的 `const` 变量默认具有**内部链接（Internal Linkage）**，效果类似 `static`（但两者并不完全等价），直接定义在头文件中不会引起多重定义冲突。

### 2. 指针与引用

指针涉及"指针本身"与"指针指向的数据"两个维度，遵循**从右向左阅读**法则（以 `*` 为分界线）：

```cpp
int x = 10;
int y = 20;

// 1. 指向常量的指针（Pointer to Const）
// const 在 * 左边：数据只读，指针本身可重定向
const int* p1 = &x;
// *p1 = 30; // 错误：不可通过 p1 修改 x
p1 = &y;     // 正确

// 2. 常量指针（Const Pointer）
// const 在 * 右边：指针本身只读，指向的数据可修改
int* const p2 = &x;
*p2 = 30;    // 正确
// p2 = &y;  // 错误：不可重定向

// 3. 指向常量的常量指针（Const Pointer to Const）
// 两者皆不可修改
const int* const p3 = &x;

// 4. 常量引用（Reference to Const）
// 引用天然不可重定向，const 约束的是引用的数据
const int& ref = x;
```

### 3. 函数中的 const 用法

| 场景 | 作用与机制 |
| --- | --- |
| **修饰入参** | 以 `const T&` 形式避免拷贝，同时允许接收左值、右值及字面量，防止函数内部篡改数据。 |
| **修饰返回值（const 引用/指针）** | 返回内部资源的只读引用/指针，防止外部调用者对其进行赋值或原地篡改。 |

```cpp
#include <iostream>
#include <string>
#include <vector>

class Database {
private:
    std::string dbName;
    std::vector<int> records;

public:
    Database(std::string name) : dbName(std::move(name)) {}

    // 1. const T& 修饰入参：避免拷贝，且防止内部误改入参
    void logQuery(const std::string& query) {
        // query += " [LOGGED]"; // 编译错误：入参被 const 保护
        std::cout << "[" << dbName << "] Query: " << query << std::endl;
    }

    // 2. const 修饰返回值：返回只读引用，外部只能读取，不能修改内部容器
    const std::vector<int>& getRecords() const {
        return records;
    }
};

int main() {
    Database db("Production");

    // 入参接收右值字面量与左值均可
    std::string userQuery = "SELECT * FROM users";
    db.logQuery(userQuery);        // 传入左值
    db.logQuery("DROP TABLE logs"); // 传入字面量临时对象

    // 返回值受 const 约束
    const auto& recs = db.getRecords();
    // recs.push_back(100); // 编译错误：不能通过 const 引用修改成员
}
```

### 4. 类与面向对象编程

#### ① 常量成员函数（Const Member Functions）

在成员函数参数列表后加 `const`，表示该函数承诺**不修改对象的任何非 mutable 成员变量** **（隐式将 `this` 指针的类型变为 `const ClassName*`）**。

```cpp
class Account {
private:
    double balance = 1000.0;
    mutable int access_count = 0; // mutable 成员不受对象逻辑 const 状态约束

public:
    // const 成员函数
    double getBalance() const {
        access_count++; // 合法：mutable 成员不受 const 约束
        // balance += 10; // 编译错误：不可修改普通成员
        return balance;
    }
};
```

#### ② 基于 const 的函数重载

成员函数可以依据是否带有 `const` 修饰符进行重载，区分可读写和只读调用：

```cpp
#include <iostream>

class Buffer {
public:
    // 非 const 版本：返回普通引用，支持读取与写入（作为可修改左值）
    char& operator[](size_t index) { 
        return data[index]; 
    }

    // const 版本：返回常量引用，仅支持只读访问
    const char& operator[](size_t index) const { 
        return data[index]; 
    }

private:
    char data[128] = "Hello World";
};

int main() {
    Buffer buf;             // 非常量对象
    buf[0] = 'h';           // 合法：调用非 const 版本，可写
    char c1 = buf[0];       // 合法：可读

    const Buffer const_buf; // 常量对象
    char c2 = const_buf[0]; // 合法：调用 const 版本，只读
    // const_buf[0] = 'X';  // 编译错误：调用 const 版本，返回 const char&，是不可修改左值
}
```

#### ③ 常量对象（Const Objects）

实例化时加 `const`，该对象的所有非 mutable 成员变为只读，且**只能调用其 `const` 成员函数**：

```cpp
const Account acc;
acc.getBalance(); // 正确：getBalance 是 const 成员函数

// 如果 deposit 声明为 const 成员函数（如 void deposit(double) const;），
// 只要其内部不修改非 mutable 成员（或仅操作 mutable 变量），那么通过 acc.deposit(100) 的调用在语法上就是完全合法的。
// 但若 deposit 试图直接修改 balance（非 mutable），deposit 本身会在定义处编译失败。
```

### 5. 类型转换与类型特征（`const_cast` & `std::remove_const`）

* **`const_cast`：** 用于显式移除（或添加）指针或引用的 `const` 属性。
> **风险提示：** 去除 `const` 属性本身并不构成未定义行为；真正引发 **未定义行为（Undefined Behavior）** 的是修改一个原本就定义为 `const` 的对象。仅在底层对象本身为非常量、但被传递为 const 引用/指针时修改才是安全的。


* **模板元编程：** 配合 `<type_traits>`（如 `std::is_const<T>`、`std::remove_const<T>`、`std::as_const`）在编译期检查或剥离常属性。

```cpp
#include <iostream>
#include <type_traits>
#include <utility>

// 示例 1: const_cast 的合法使用场景（底层对象本身是非常量）
void legacyAPI(char* str) {
    // 假设这是一个陈旧的 C 库 API，接收 char* 但实际上只读，不做修改
    std::cout << "Legacy output: " << str << std::endl;
}

void printData(const char* data) {
    // legacyAPI(data); // 编译错误：不能将 const char* 转为 char*
    legacyAPI(const_cast<char*>(data)); // 合法：仅作为适配器传递
}

// 示例 2: 修改原本定义为 const 的对象引发未定义行为
void dangerousCast() {
    const int readOnlyVal = 100; // 本身就是常量，可能存放在只读内存区
    int* ptr = const_cast<int*>(&readOnlyVal);
    // *ptr = 200; // 语法能通过，但运行时属于未定义行为（UB）！
}

// 示例 3: 模板元编程中的 const 操作
template <typename T>
void inspectType(T&& param) {
    using NoRef = typename std::remove_reference<T>::type;
    static_assert(std::is_const<NoRef>::value, "NoRef should be const");
}

int main() {
    char text[] = "Safe to read";
    printData(text);

    int val = 42;
    inspectType(std::as_const(val)); // std::as_const 将左值转为 const 引用
}
```

### 6. C++ 现代演进：`constexpr`、`consteval` 与 `constinit`

现代 C++ 将只读约束与常量求值进一步解耦和精细化控制：

| 关键字 | 标准 | 核心语义 | 是否隐含 const | 解决的核心问题 |
| --- | --- | --- | --- | --- |
| **`const`** | C++98 | 控制能否修改，不保证可用于常量求值 | — | 数据访问保护 |
| **`constexpr`** | C++11 | 控制能否用于**常量求值**（变量要求初始化式为常量表达式，函数则可用于常量表达式） | 变量：是；函数：否（C++11 曾隐含 const 成员，C++14 起取消） | 性能优化、模板元编程参数 |
| **`consteval`** | C++20 | **立即函数**，对该函数的调用**必须**完成常量求值 | 否 | 要求调用必须完成常量求值 |
| **`constinit`** | C++20 | 强制变量进行**常量初始化**（仅限静态/线程存储期变量），但变量**允许运行期修改** | **否**（除非显式叠加 const） | 避免该变量因动态初始化而卷入**静态初始化顺序问题**（Static Initialization Order Fiasco） |

```cpp
#include <iostream>

constexpr int getSquare(int n) { return n * n; }
consteval int getFactorial(int n) { return n <= 1 ? 1 : n * getFactorial(n - 1); }

// 1. constexpr: 编译期初始化，且自身不可修改 (隐含 const)
constexpr int max_limit = getSquare(10); 

// 2. consteval: 强制该调用完成常量求值
int fact = getFactorial(5); // consteval 本身即要求此调用完成常量求值
// int n = 5; getFactorial(n); // 编译错误：实参非常量表达式

// 3. constinit: 必须常量初始化，但运行期允许修改（全局/静态变量）
constinit int global_counter = getSquare(2); 

// 如果与 const 结合，则既常量初始化又是常量
inline constinit const int immutable_init = 100;

int main() {
    global_counter++; // 正确：constinit 变量本身不带 const 属性，运行期可正常修改
    std::cout << "Counter: " << global_counter << std::endl; // 输出 5
}
```

`const` 管能否修改，`constexpr` 管能否用于常量求值，`consteval` 管调用是否必须完成常量求值，`constinit` 管是否必须常量初始化。
