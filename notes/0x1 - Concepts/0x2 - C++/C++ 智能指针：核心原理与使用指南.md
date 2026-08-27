---
title: "C++ 智能指针：核心原理与使用指南"
date: "2026-08-27"
summary: "解析智能指针的 RAII 基础与所有权模型，涵盖 unique_ptr、shared_ptr、weak_ptr 的选择、用法和常见陷阱。"
category: "C++"
tags:
  - "C++"
  - "智能指针"
  - "RAII"
  - "所有权"
  - "资源管理"
---

## 1. 引言：智能指针为什么会出现

C++ 允许程序员直接管理内存和其他系统资源。这种能力带来了较高的性能和控制自由度，但也带来了一个根本问题：**资源的生命周期必须由程序员正确维护**。

传统的动态内存管理通常使用 `new` 和 `delete`：

```cpp
int* p = new int(42);

// 使用 p

delete p;
```

这段代码本身并不复杂，真正的困难在于：随着程序出现分支、循环、异常、函数提前返回以及多个对象之间的引用关系，程序员很难保证每一次 `new` 都能在正确的时刻对应一次 `delete`。

例如：

```cpp
void process()
{
    int* p = new int(42);

    doSomething();  // 如果这里抛出异常

    delete p;       // 这一行不会执行
}
```

如果 `doSomething()` 抛出异常，函数会提前退出，`delete p` 无法执行，由此产生内存泄漏。

裸指针管理动态资源时，常见问题包括：

- **内存泄漏**：资源申请后没有释放；
- **重复释放**：同一块内存被 `delete` 多次；
- **悬空指针**：指针仍然存在，但它所指向的对象已经被销毁；
- **所有权不明确**：无法仅从一个指针判断“谁负责释放对象”；
- **异常安全不足**：异常或提前返回使清理代码无法执行；
- **复杂共享关系**：多个对象共同使用同一资源时，很难确定最终释放时机。

智能指针正是为解决这些问题而出现的。它并不是一种新的指针类型，而是一个遵循特定所有权规则的类模板。它把裸指针封装在对象内部，并在适当的时机自动释放资源。

## 2. 核心问题不是“指针”，而是“所有权”

理解智能指针之前，需要先理解资源所有权。

对于一个动态创建的对象，程序必须回答以下问题：

1. 谁拥有这个对象？
2. 谁负责销毁这个对象？
3. 对象应该在什么时候被销毁？
4. 是否允许多个对象共同拥有它？
5. 其他位置只是临时访问它，还是也承担生命周期管理责任？

裸指针本身不能回答这些问题：

```cpp
Widget* p;
```

仅从这条声明无法判断：

- `p` 是否拥有 `Widget`；
- `p` 是否需要执行 `delete`；
- `p` 指向的是动态对象、栈对象，还是某个对象的子对象；
- 是否还有其他指针共同负责对象的生命周期。

智能指针的主要价值，就是把**所有权语义明确地写进类型系统**：

| 类型 | 表达的所有权语义 |
| --- | --- |
| `std::unique_ptr<T>` | 对象只有一个所有者 |
| `std::shared_ptr<T>` | 对象可以有多个共同所有者 |
| `std::weak_ptr<T>` | 只观察共享对象，不拥有对象 |

因此，选择智能指针的本质不是选择一种语法，而是选择一种正确的生命周期模型。

## 3. 智能指针的基础：RAII

智能指针建立在 C++ 的 RAII 思想之上。

RAII 是 **Resource Acquisition Is Initialization** 的缩写，通常译为“资源获取即初始化”。它的核心思想是：

> 将资源的生命周期绑定到一个局部对象的生命周期上。

对象在进入作用域时获得资源，在离开作用域时由析构函数自动释放资源。C++ 能够保证正常退出、提前返回以及异常展开时，已经构造完成的局部对象都会被正确析构。

一个简化的智能指针可以写成：

```cpp
template <typename T>
class SimplePtr
{
public:
    explicit SimplePtr(T* ptr) : ptr_(ptr) {}

    ~SimplePtr()
    {
        delete ptr_;
    }

    T& operator*() const
    {
        return *ptr_;
    }

    T* operator->() const
    {
        return ptr_;
    }

private:
    T* ptr_;
};
```

当 `SimplePtr` 离开作用域时，它的析构函数自动调用 `delete`。真正的标准智能指针还需要处理移动、复制、删除器、线程安全等问题，但基本思想与此一致。

这里有一个重要结论：

> 智能指针不是通过“自动检测内存是否无用”来回收内存，而是根据明确的所有权规则，在所有者生命周期结束时释放资源。

它与 Java、C# 中的垃圾回收机制并不相同。智能指针的销毁时机通常是确定的，依靠的是对象析构和所有权计数，而不是运行时垃圾回收器。

## 4. `std::unique_ptr`：独占所有权

### 4.1 基本概念

`std::unique_ptr<T>` 表示某个动态对象在同一时刻只能有一个所有者。当这个 `unique_ptr` 被销毁时，它拥有的对象也会被销毁。

```cpp
#include <memory>

void example()
{
    std::unique_ptr<int> p = std::make_unique<int>(42);
    std::cout << *p << '\n';
} // p 被析构，int 对象自动释放
```

通常应优先使用 `std::make_unique`，而不是手动写 `new`：

```cpp
auto p = std::make_unique<Widget>();
```

这种写法更简洁，也能减少裸指针在程序中短暂暴露的机会。

### 4.2 为什么不能复制

如果两个 `unique_ptr` 同时指向同一对象，它们都会认为自己负责释放该对象，最终会发生重复释放。因此，`unique_ptr` 禁止复制：

```cpp
auto p1 = std::make_unique<int>(42);

// auto p2 = p1;  // 编译错误：不能复制独占所有权
```

但所有权可以被转移。转移之后，原指针不再拥有对象：

```cpp
auto p1 = std::make_unique<int>(42);
auto p2 = std::move(p1);

// 此时 p1 为空，p2 拥有对象
if (!p1)
{
    std::cout << "p1 no longer owns the object\n";
}
```

这正是移动语义在资源管理中的典型用途：**资源本身没有被复制，只是所有权发生了转移**。

### 4.3 适用场景

`unique_ptr` 适用于：

- 一个对象明确拥有另一个动态对象；
- 工厂函数需要返回一个新创建的对象；
- 多态对象需要通过基类指针管理；
- 资源需要保存在容器中，但不需要共享所有权；
- 希望明确表达“此资源只能有一个负责人”。

例如，工厂函数可以直接返回 `unique_ptr`：

```cpp
class Shape
{
public:
    virtual ~Shape() = default;
    virtual void draw() const = 0;
};

class Circle : public Shape
{
public:
    void draw() const override
    {
        std::cout << "Draw a circle\n";
    }
};

std::unique_ptr<Shape> createShape()
{
    return std::make_unique<Circle>();
}
```

由于返回值会触发移动或返回值优化，这种写法通常不需要额外复制资源。

### 4.4 常用操作

```cpp
auto p = std::make_unique<int>(42);

int value = *p;      // 访问对象
int* raw = p.get();  // 取得裸指针，但不转移所有权

p.reset();           // 释放当前对象，使 p 变为空

p = std::make_unique<int>(100);
int* released = p.release(); // 放弃所有权，但不释放对象
delete released;             // 调用者必须自行负责释放
```

应特别谨慎地使用 `release()`。它会使智能指针放弃管理责任，但不会销毁对象；若返回的裸指针没有被妥善接管，就会造成泄漏。

### 4.5 管理动态数组

`unique_ptr` 支持动态数组：

```cpp
auto values = std::make_unique<int[]>(100);
values[0] = 10;
```

不过，如果数组长度需要动态变化，通常应优先使用 `std::vector`。`vector` 不仅负责资源管理，还保存长度并提供更完整的容器接口。

## 5. `std::shared_ptr`：共享所有权

### 5.1 为什么需要共享所有权

有些对象不能明确归属于单一所有者。例如，一个数据对象可能同时被多个模块异步使用，只有当最后一个使用者离开后，它才能被销毁。

`std::shared_ptr<T>` 用引用计数表达这种关系：

```cpp
auto p1 = std::make_shared<Widget>();
auto p2 = p1;
auto p3 = p2;
```

此时有三个 `shared_ptr` 共同拥有同一个 `Widget`。每增加一个共享所有者，强引用计数增加；每销毁或重置一个共享所有者，强引用计数减少。当强引用计数变为零时，对象被销毁。

```cpp
auto p1 = std::make_shared<int>(42);
std::cout << p1.use_count() << '\n'; // 通常为 1

{
    auto p2 = p1;
    std::cout << p1.use_count() << '\n'; // 通常为 2
}

std::cout << p1.use_count() << '\n'; // 再次为 1
```

`use_count()` 适合用于观察和调试，但不应将它作为业务逻辑判断的基础，因为在并发环境中，计数可能随时变化。

### 5.2 控制块

`shared_ptr` 通常涉及两部分数据：

1. 指向实际对象的指针；
2. 一个独立的控制块。

控制块通常保存：

- 强引用计数，即 `shared_ptr` 所有者数量；
- 弱引用计数，即关联的 `weak_ptr` 数量及实现所需状态；
- 对象的删除器；
- 可能存在的分配器信息。

可以将其关系简化为：

```text
shared_ptr A ─┐
              ├──> 控制块 ───> 被管理对象
shared_ptr B ─┘      │
weak_ptr C ──────────┘
```

多个 `shared_ptr` 必须共享同一个控制块，引用计数才能正确工作。

### 5.3 为什么推荐 `std::make_shared`

推荐写法是：

```cpp
auto p = std::make_shared<Widget>();
```

而不是：

```cpp
std::shared_ptr<Widget> p(new Widget());
```

`make_shared` 通常可以把控制块和对象放在一次内存分配中，因此具有以下优点：

- 代码更简洁；
- 减少直接使用 `new`；
- 通常只需一次内存分配，局部性和效率更好；
- 更容易保证异常安全。

需要注意：由于对象和控制块可能位于同一块分配内存中，即使对象已经因强引用归零而析构，只要仍有 `weak_ptr` 保持控制块存活，这块整体内存也可能暂时不能归还。对于体积很大的对象或特殊内存策略，可以根据实际情况使用显式构造方式。

### 5.4 `shared_ptr` 的成本

`shared_ptr` 并不是默认情况下越多越好。与 `unique_ptr` 相比，它通常具有额外成本：

- 需要控制块；
- 复制和销毁时需要更新引用计数；
- 引用计数更新通常需要满足线程安全要求；
- 共享所有权容易掩盖对象真正的生命周期设计；
- 可能产生循环引用。

因此，只有当资源确实需要共享所有权时，才应使用 `shared_ptr`。不能确定时，应优先考虑 `unique_ptr`。

### 5.5 线程安全的准确含义

不同的 `shared_ptr` 实例如果共享同一个控制块，可以在不同线程中复制和销毁，引用计数本身会被安全维护。但是：

- 被管理对象本身不会因此自动变成线程安全对象；
- 同一个 `shared_ptr` 实例被多个线程同时修改，仍需要同步，或使用标准提供的原子智能指针相关接口。

智能指针保证的是特定的生命周期管理安全，不是对象内部数据访问的线程安全。

## 6. `std::weak_ptr`：观察而不拥有

`std::weak_ptr<T>` 不能独立拥有对象，也不能直接通过裸指针建立观察关系。它必须从 `shared_ptr` 或另一个 `weak_ptr` 获得对应的控制块：

```cpp
auto owner = std::make_shared<Widget>();
std::weak_ptr<Widget> observer = owner;
```

### 6.1 循环引用问题

引用计数有一个固有缺陷：它无法单独解决循环引用。

```cpp
class B;

class A
{
public:
    std::shared_ptr<B> b;
};

class B
{
public:
    std::shared_ptr<A> a;
};

void createCycle()
{
    auto a = std::make_shared<A>();
    auto b = std::make_shared<B>();

    a->b = b;
    b->a = a;
}
```

函数结束后，局部变量 `a` 和 `b` 被销毁，但两个对象仍通过内部的 `shared_ptr` 互相拥有。双方的强引用计数都不为零，因此两个对象都不会被销毁。

这不是传统意义上的“忘记写 `delete`”，而是所有权模型本身形成了闭环。

### 6.2 用 `weak_ptr` 打破所有权环

`std::weak_ptr<T>` 可以引用由 `shared_ptr` 管理的对象，但不会增加强引用计数。因此，它不延长对象的生命周期。

将其中一条非拥有关系改为 `weak_ptr`：

```cpp
class B;

class A
{
public:
    std::shared_ptr<B> b;
};

class B
{
public:
    std::weak_ptr<A> a;
};
```

此时 `A` 拥有 `B`，而 `B` 只是观察 `A`。函数结束后，所有权链能够正常断开，对象会被销毁。

### 6.3 为什么不能直接解引用

`weak_ptr` 不保证对象仍然存在。因此，使用对象前必须先尝试将它提升为 `shared_ptr`：

```cpp
std::weak_ptr<Widget> observer;

{
    auto owner = std::make_shared<Widget>();
    observer = owner;

    if (auto p = observer.lock())
    {
        p->doWork();
    }
}

if (observer.expired())
{
    std::cout << "The object has been destroyed\n";
}
```

`lock()` 会执行一次安全检查：

- 如果对象仍存在，返回一个有效的 `shared_ptr`；
- 如果对象已经销毁，返回空的 `shared_ptr`。

相比先调用 `expired()` 再访问，直接使用 `lock()` 更可靠，因为检查和取得临时所有权在同一个操作中完成，更适合并发场景。

### 6.4 典型用途

`weak_ptr` 常用于：

- 打破双向关系中的循环引用；
- 缓存：缓存可以观察对象，但不应强制对象永久存活；
- 观察者模式：观察者需要知道目标是否仍然存在；
- 父子节点关系：父节点拥有子节点，子节点只观察父节点；
- 异步回调：回调执行时先检查目标对象是否仍然有效。

## 7. 三种智能指针应该如何选择

可以按以下顺序判断：

1. 如果对象不需要动态分配，直接使用普通局部对象或成员对象；
2. 如果对象需要动态生命周期，并且只有一个所有者，使用 `unique_ptr`；
3. 如果确实存在多个地位相同的所有者，使用 `shared_ptr`；
4. 如果只需要观察由 `shared_ptr` 管理的对象，而不应延长其生命周期，使用 `weak_ptr`；
5. 裸指针或引用可以用于短期访问，但应明确它们不承担所有权。

简化的选择表如下：

| 需求 | 推荐方式 |
| --- | --- |
| 作用域内直接使用对象 | 普通局部对象 |
| 独占动态对象 | `std::unique_ptr` |
| 转移动态对象的所有权 | 移动 `std::unique_ptr` |
| 多方共同决定对象寿命 | `std::shared_ptr` |
| 观察共享对象是否仍存在 | `std::weak_ptr` |
| 临时访问且不接管所有权 | `T&`、`const T&` 或 `T*` |
| 长度可变的动态序列 | 通常使用 `std::vector<T>` |

一个实用原则是：

> 优先使用值语义；确需动态所有权时优先使用 `unique_ptr`；只有明确需要共享所有权时才使用 `shared_ptr`。

## 8. 智能指针作为函数参数时表达什么

函数参数类型也应该表达函数对资源的意图。

### 8.1 只访问对象

如果函数只使用对象，不保存所有权，通常传引用或裸指针：

```cpp
void print(const Widget& widget);
void update(Widget& widget);
void tryUpdate(Widget* widget); // 允许传入空指针
```

没有必要为了“看起来安全”而把所有参数都写成 `shared_ptr`。智能指针主要负责表达所有权，而普通引用更适合表达临时访问。

### 8.2 接收独占所有权

如果函数要接管对象，按值接收 `unique_ptr`：

```cpp
void setWidget(std::unique_ptr<Widget> widget)
{
    ownedWidget = std::move(widget);
}

auto widget = std::make_unique<Widget>();
setWidget(std::move(widget));
```

调用处的 `std::move` 明确表明所有权被转移。

### 8.3 共享所有权

如果函数需要在调用结束后继续持有对象，可以按值接收 `shared_ptr`：

```cpp
void registerWidget(std::shared_ptr<Widget> widget)
{
    widgets.push_back(std::move(widget));
}

auto widget = std::make_shared<Widget>();
registerWidget(widget);            // 复制共享所有权，widget 仍然持有对象
registerWidget(std::move(widget)); // 转移这一份共享所有权，widget 随后为空
```

如果函数仅在调用期间访问对象，则更适合接收 `Widget&` 或 `const Widget&`，从而避免无意义的引用计数变化，并准确表达“不参与所有权”。

## 9. 自定义删除器：智能指针不仅能管理 `new` 出来的内存

智能指针可以配合自定义删除器管理文件、网络连接、系统句柄等资源。核心仍然是 RAII：析构时执行相应的释放操作。

```cpp
#include <cstdio>
#include <memory>
#include <iostream>

struct FileCloser
{
    void operator()(std::FILE* file) const
    {
        if (file != nullptr)
        {
            std::cout << "[RAII 日志] 自动关闭文件句柄成功！\n";
            std::fclose(file);
        }
    }
};

using FilePtr = std::unique_ptr<std::FILE, FileCloser>;

FilePtr openFile(const char* path)
{
    return FilePtr(std::fopen(path, "r"));
}

void readFileExample()
{
    // 1. 打开文件
    FilePtr file = openFile("test.txt");

    // 2. 检查是否打开成功
    if (!file)
    {
        std::cout << "文件打开失败或不存在。\n";
        return; // 提前 return，不会泄露，析构安全
    }

    // 3. 使用原生指针：通过 file.get() 传给 C 风格 API
    char buffer[128];
    if (std::fgets(buffer, sizeof(buffer), file.get()) != nullptr)
    {
        std::cout << "读取内容: " << buffer << '\n';
    }

    // 4. 函数结束时，file 离开作用域，自动调用 FileCloser
}

int main()
{
    readFileExample();
    return 0;
}
```

当 `FilePtr` 离开作用域时，它不会执行 `delete`，而是调用 `FileCloser` 中的 `std::fclose`。

需要注意，`unique_ptr` 的删除器类型是其类型的一部分；`shared_ptr` 的删除器通常存放在控制块中，不体现在 `shared_ptr<T>` 的模板参数中。  
`unique_ptr` 的完整模板声明包含两个参数：

```cpp
template<class T, class Deleter = std::default_delete<T>>
class unique_ptr;
```

## 10. 常见问题

### 10.1 用同一个裸指针构造多个 `shared_ptr`

下面的代码是错误的：

```cpp
Widget* raw = new Widget();

std::shared_ptr<Widget> p1(raw);
std::shared_ptr<Widget> p2(raw); // 错误
```

`p1` 和 `p2` 分别创建了两个控制块。它们都认为自己是对象的管理者，最终会对同一个地址执行两次删除。

正确方式是复制已有的 `shared_ptr`：

```cpp
auto p1 = std::make_shared<Widget>();
auto p2 = p1;
```

### 10.2 用智能指针管理栈对象

```cpp
Widget widget;
std::unique_ptr<Widget> p(&widget); // 错误
```

`widget` 并不是通过 `new` 创建的，但 `p` 析构时会尝试对它执行 `delete`，导致未定义行为。

### 10.3 忘记多态基类需要虚析构函数

通过基类指针销毁派生类对象时，基类通常必须具有虚析构函数：

```cpp
class Base
{
public:
    virtual ~Base() = default;
};
```

智能指针不能弥补错误的多态析构设计。它只会按照自身保存的删除规则执行销毁。

### 10.4 把 `get()` 返回的指针交给另一个所有者

```cpp
auto p1 = std::make_unique<Widget>();
std::unique_ptr<Widget> p2(p1.get()); // 错误
```

`get()` 只提供临时访问，并不转移所有权。这样做会产生两个独立所有者，最终导致重复释放。

### 10.5 滥用 `shared_ptr`

把所有动态对象都放入 `shared_ptr` 虽然有时可以暂时减少显式的生命周期思考，却会带来以下后果：

- 谁真正拥有对象变得模糊；
- 对象销毁时机难以推断；
- 更容易出现循环引用；
- 引用计数带来不必要的成本；
- 接口无法准确表达所有权意图。

`shared_ptr` 应表示真实存在的共享所有权，而不是作为不确定设计的默认答案。

### 10.6 从对象内部随意创建 `shared_ptr<this>`

下面的做法会创建新的控制块，是危险的：

```cpp
std::shared_ptr<Widget> Widget::getSelf()
{
    return std::shared_ptr<Widget>(this); // 错误
}
```

如果对象已经由另一个 `shared_ptr` 管理，就会产生两个控制块。需要从对象内部安全取得共享所有权时，可以继承 `std::enable_shared_from_this`：

```cpp
class Widget : public std::enable_shared_from_this<Widget>
{
public:
    std::shared_ptr<Widget> getSelf()
    {
        return shared_from_this();
    }
};

auto widget = std::make_shared<Widget>();
auto sameObject = widget->getSelf();
```

使用 `shared_from_this()` 的前提是该对象已经由合适的 `shared_ptr` 管理，否则会抛出 `std::bad_weak_ptr`。

## 11. 一个完整的所有权设计示例

下面以树形结构为例说明三种关系：

- 父节点独占各个子节点，因此使用 `unique_ptr`；
- 子节点需要访问父节点，但不拥有父节点，因此使用裸指针作为非拥有观察者；
- 外部函数只临时读取节点，因此传入常量引用。

```cpp
#include <iostream>
#include <memory>
#include <string>
#include <utility>
#include <vector>

class Node
{
public:
    explicit Node(std::string name, Node* parent = nullptr)
        : name_(std::move(name)), parent_(parent)
    {
    }

    Node& addChild(std::string name)
    {
        auto child = std::make_unique<Node>(std::move(name), this);
        Node& result = *child;
        children_.push_back(std::move(child));
        return result;
    }

    const std::string& name() const
    {
        return name_;
    }

    const Node* parent() const
    {
        return parent_;
    }

private:
    std::string name_;
    Node* parent_; // 非拥有指针，父节点的寿命覆盖子节点
    std::vector<std::unique_ptr<Node>> children_;
};

void printNode(const Node& node)
{
    std::cout << node.name();

    if (const Node* parent = node.parent())
    {
        std::cout << " (parent: " << parent->name() << ')';
    }

    std::cout << '\n';
}

int main()
{
    auto root = std::make_unique<Node>("root");
    Node& child = root->addChild("child");

    printNode(child);
}
```

这个例子的关键不在于使用了多少智能指针，而在于每一种关系都有清晰含义：

- `root` 独占根节点；
- `children_` 独占子节点；
- `parent_` 只是回指，不负责释放；
- `printNode` 只访问节点，不参与所有权。

这比“所有地方都使用 `shared_ptr`”更清晰，也更容易推断销毁顺序。

## 12. 智能指针能解决什么，不能解决什么

### 12.1 能够解决的问题

在所有权设计正确的前提下，智能指针能够：

- 自动释放动态资源；
- 提供异常安全的资源清理；
- 防止大量由遗漏 `delete` 引起的泄漏；
- 明确表达独占、共享和观察关系；
- 支持安全的所有权转移；
- 将资源管理融入类型和作用域。

### 12.2 不能自动解决的问题

智能指针不能自动保证整个程序没有生命周期错误。它无法替代正确的设计，例如：

- 错误的共享所有权关系仍可能形成循环引用；
- 从 `get()` 取得的裸指针仍可能变成悬空指针；
- 对象本身仍可能存在越界访问、数据竞争等错误；
- 错误的自定义删除器仍会错误释放资源；
- 把不属于自己的地址交给智能指针仍会导致未定义行为；
- 智能指针不能自动判断业务层面“谁应该拥有谁”。

因此，智能指针解决的是**资源释放机制**和**所有权表达方式**，而正确的对象关系仍需要程序员设计。

## 13. 使用原则

1. 优先创建普通局部对象，不要无理由地动态分配。
2. 需要独占动态所有权时，优先使用 `std::unique_ptr`。
3. 使用 `std::make_unique` 和 `std::make_shared` 创建对象。
4. 只有确实存在共同所有权时才使用 `std::shared_ptr`。
5. 使用 `std::weak_ptr` 表示对共享对象的非拥有观察，并打破循环引用。
6. 只访问对象的函数通常接收引用或裸指针，不必接收智能指针。
7. 不要使用同一个裸指针构造多个独立智能指针。
8. 不要对 `get()` 返回的地址执行 `delete`，也不要用它创建新的所有者。
9. 谨慎使用 `release()`，因为调用之后资源管理责任重新回到程序员手中。
10. 让接口通过类型明确表达“访问、转移、共享或观察”中的哪一种语义。

## 14. 总结

智能指针出现的直接原因，是手动管理动态资源容易受到复杂控制流和模糊所有权关系的影响。它通过 RAII 将资源生命周期绑定到对象生命周期，并用不同类型表达不同的所有权模型。

三种智能指针可以概括为：

- `std::unique_ptr`：只有一个所有者，所有权可以移动；
- `std::shared_ptr`：多个所有者通过引用计数共同维持对象生命周期；
- `std::weak_ptr`：观察共享对象，但不延长其生命周期。

---

> 智能指针的核心在于明确资源的所有权与生命周期，即确定对象的持有者及其销毁时机。
