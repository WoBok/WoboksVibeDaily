---
title: "C++ explicit 关键字"
date: "2026-08-27"
summary: "说明 explicit 如何限制构造函数和类型转换运算符的隐式转换，并通过显式调用提升类型安全。"
category: "C++"
tags:
  - "C++"
  - "explicit"
  - "构造函数"
  - "类型转换"
---

`explicit` 在 C++ 中的主要作用是**禁止单参数构造函数（或其余参数均有默认值的多参数构造函数）的隐式类型转换，以及禁止类型转换运算符的隐式自动转换**，要求必须通过显式调用来完成类型转换，从而避免意料之外的隐式转换 bug。

---

**主要应用场景**

* **修饰构造函数（防止隐式转换）**
当类的构造函数可以接收单个参数时，编译器默认允许将该参数类型隐式转换为该类对象。加上 `explicit` 后，赋值初始化或隐式传参将被禁止。
```cpp
class MyClass {
public:
    explicit MyClass(int size) {}
};

void func(MyClass obj) {}

MyClass a(10);     // 正确：直接初始化（显式）
MyClass b = 10;    // 错误：explicit 禁止隐式转换
func(20);          // 错误：禁止将 int 隐式转为 MyClass
func(MyClass(20)); // 正确：显式构建临时对象
```


* **修饰类型转换运算符（C++11 起）**
防止自定义的类型转换操作符被随意隐式调用，通常用于安全的布尔判断（如 `std::unique_ptr` 或 `std::cin` 的 `explicit operator bool()`）。
```cpp
#include <iostream>

class SafePointer {
    int* ptr;
public:
    SafePointer(int* p = nullptr) : ptr(p) {}

    // 加了 explicit：只允许显式转换或条件判断中的语境转换
    explicit operator bool() const {
        return ptr != nullptr;
    }
};

int main() {
    SafePointer p(new int(42));

    // 1. 好的用法：条件判断中自然成立（语境转换）
    if (p) {
        std::cout << "指针有效\n";
    }

    // 2. 显式转换：完全合法
    bool isValid = static_cast<bool>(p);

    // 3. 拦截危险操作：
    // 若不加 explicit，以下两行均能正常编译运行：
    // - bool b = p;      -> 隐式赋值破坏类型安全边界
    // - int sum = p + 5; -> 对象隐式转为 bool(true) 再整型提升为 1，荒谬地算成 1 + 5 = 6
    // 加上 explicit 即可杜绝“对象意外退化为整数参与算术”的经典 Bug。
    // int sum = p + 5;   // 错误！explicit 成功拦截隐式转换
    // bool b = p;        // 错误！explicit 成功拦截隐式赋值
}
```

---

`explicit` 就是给类型转换“加一把安全锁”，强迫显式调用，防止编译器背着你悄悄做类型转换而引发 Bug。


