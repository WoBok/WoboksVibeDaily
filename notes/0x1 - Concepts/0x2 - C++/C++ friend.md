---
title: "C++ friend"
date: "2026-09-22"
summary: "说明 C++ friend 如何授权函数、类或特定成员函数访问非公有成员，并梳理友元关系的单向性、非传递性和不可继承性。"
category: "C++"
tags:
  - "C++"
  - "friend"
  - "友元函数"
  - "友元类"
  - "访问控制"
---

在 C++ 中，**`friend`（友元）** 机制允许外部函数或另一个类访问当前类的 **`private`（私有）** 和 **`protected`（受保护）** 成员。

它本质上是在面向对象的**严格封装**与某些场景下的**效率与表达力**之间做出的权衡与突破。

---

### 一、常见用法

#### 1. 友元函数（Friend Function）

普通全局函数不是类的成员函数，但被声明为该类的友元后，可直接通过对象访问其非公有成员。

```cpp
#include <iostream>

class Box {
private:
    int width;

public:
    Box(int w) : width(w) {}

    // 声明全局函数 printWidth 为友元
    friend void printWidth(const Box& b);
};

// 普通全局函数，无需 Box:: 作用域
void printWidth(const Box& b) {
    // 直接访问私有成员 width
    std::cout << "Width: " << b.width << std::endl;
}
```

#### 2. 友元类（Friend Class）

若将类 `B` 声明为类 `A` 的友元类，则**类 `B` 的所有成员函数**都可以访问类 `A` 的私有与受保护成员。

```cpp
class Screen {
private:
    int width = 800;
    int height = 600;

    // WindowManager 是 Screen 的友元类
    friend class WindowManager;
};

class WindowManager {
public:
    void printScreenSize(const Screen& s) {
        // 直接访问 Screen 的私有成员
        std::cout << s.width << "x" << s.height << std::endl;
    }
};
```

#### 3. 友元成员函数（Friend Member Function）

若只想授予另一个类的**某一个特定方法**访问权，而非暴露给整个类，可精确声明该成员函数为友元。

```cpp
#include <iostream>

class Screen; // 前向声明

class WindowManager {
public:
    void clear(Screen& s); // 仅在类内声明
};

class Screen {
private:
    int width = 800;
    int height = 600;

    // 仅授权 WindowManager 中的 clear 函数
    friend void WindowManager::clear(Screen& s);
};

void WindowManager::clear(Screen& s) {
    s.width = 0;   // 直接修改 Screen 的私有成员
    s.height = 0;
    std::cout << "Screen cleared: " << s.width << "x" << s.height << std::endl;
}
```

### 二、关键特性

* **单向性（Not Symmetric）**：若 `B` 是 `A` 的友元，并不意味着 `A` 是 `B` 的友元。`A` 不能访问 `B` 的私有成员。
* **不具备传递性（Not Transitive）**：若 `B` 是 `A` 的友元，`C` 是 `B` 的友元，`C` 无法自动成为 `A` 的友元。
* **不能被继承（Not Inherited）**：基类的友元不会自动成为派生类的友元；派生类的友元也无权直接访问基类的私有成员。

---

友元是类主动签署的特权单，单向、不传、不继承，专门开后门访问私有成员。