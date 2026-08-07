# C++ 迭代器详解 —— 从传统 for 循环到 TActorIterator

> **起因**：`BaseBlueprintLibraryBPLibrary.cpp` 的 `GetAllActorsCount` 里出现了这样一行
>
> ```cpp
> for (TActorIterator<AActor> It(World); It; ++It)
> ```
>
> 它和 `for (int32 i = 0; i <= 10; ++i)` 长得完全不一样。本文从头讲清楚这套语法的来龙去脉。

---

## 目录

- [一、传统 for 循环的隐含前提](#一传统-for-循环的隐含前提)
- [二、迭代器：把"位置"打包成一个对象](#二迭代器把位置打包成一个对象)
- [三、两种流派：`It != End` 还是 `if (It)`？](#三两种流派it--end-还是-if-it)
- [四、回到代码，逐字对照](#四回到代码逐字对照)
- [五、实用举例](#五实用举例)
- [六、语法使用方法总结](#六语法使用方法总结)
- [七、必须避开的坑](#七必须避开的坑)

---

## 一、传统 for 循环的隐含前提

```cpp
for (int32 i = 0; i <= 10; ++i) { ... }
```

这个循环之所以能工作，靠的是一个很强的假设：**数据是"按编号连续排列"的**，你只要报出编号 `i`，就能 O(1) 拿到第 i 个元素。

```cpp
TArray<int32> Numbers = {10, 20, 30};
for (int32 i = 0; i < Numbers.Num(); ++i)
{
    UE_LOG(LogTemp, Log, TEXT("%d"), Numbers[i]);   // Numbers[i] 本质是 *(起始地址 + i)
}
```

数组能这么干，是因为元素在内存里紧挨着，第 i 个的地址 = 首地址 + i × 元素大小。一次乘法一次加法，直接算出来。

**问题来了：不是所有数据结构都长这样。**

### 链表：下标失效的典型

```cpp
struct FNode { int32 Value; FNode* Next; };
```

链表的节点散落在内存各处，靠 `Next` 指针串起来。想拿第 5 个元素，你必须从头 `Next` 五次。如果硬要写 `for (i=0; i<N; ++i) GetAt(i)`，每次 `GetAt(i)` 内部都要重新从头走一遍 —— 整个循环从 O(N) 退化成 O(N²)。

链表的正确遍历方式其实是这样：

```cpp
for (FNode* Cur = Head; Cur != nullptr; Cur = Cur->Next)
{
    UE_LOG(LogTemp, Log, TEXT("%d"), Cur->Value);
}
```

**注意看这个 for 的三段**：初始化不是 `i = 0` 而是 `Cur = Head`；条件不是 `i < N` 而是 `Cur != nullptr`；步进不是 `++i` 而是 `Cur = Cur->Next`。

### 关键洞察

`for` 循环的三段式从来没规定过必须用整数下标。它真正要求的只有四件事：

| 语义 | 数组版 | 链表版 |
|---|---|---|
| ① 定位到开头 | `i = 0` | `Cur = Head` |
| ② 判断"还没走完" | `i < Num` | `Cur != nullptr` |
| ③ 走到下一个 | `++i` | `Cur = Cur->Next` |
| ④ 取出当前元素 | `Arr[i]` | `Cur->Value` |

再看二叉树 —— 遍历要靠递归或显式栈；再看哈希表（`TMap`）—— 底层是稀疏桶数组，很多槽是空的，"下一个"意味着"跳过空槽直到找到有效元素"。**每种容器的这四件事写法都不一样。**

---

## 二、迭代器：把"位置"打包成一个对象

于是有人想：既然每种容器的"当前位置"含义不同，那就**为每种容器写一个专门的小对象，让它负责记住位置、知道怎么前进、知道什么时候到头**。这个小对象就叫**迭代器（Iterator）**。

> 迭代器 = **一个行为像指针的对象**。它内部藏着"当前走到哪了"的状态，外部只暴露统一的几个操作。

最大的好处：**遍历代码的样子不再随容器变化**。不管底层是数组、链表、红黑树还是哈希表，用起来都是 `*It` 取值、`++It` 前进。

### 怎么让一个"对象"用起来像指针？—— 运算符重载

C++ 允许你给自定义类型定义 `*`、`++`、`->`、`==` 这些运算符的含义。这就是迭代器的全部魔法所在，没有别的了。

手写一个就彻底明白了：

```cpp
// 一个自己实现的、极简的数组迭代器
class FMyIterator
{
public:
    explicit FMyIterator(int32* InPtr) : Ptr(InPtr) {}

    // ① 解引用：让 *It 拿到当前元素
    int32& operator*() const { return *Ptr; }

    // ② 前置自增：让 ++It 前进一格，并返回自己（方便连写）
    FMyIterator& operator++() { ++Ptr; return *this; }

    // ③ 比较：让 It != End 能判断是否走完
    bool operator!=(const FMyIterator& Other) const { return Ptr != Other.Ptr; }

private:
    int32* Ptr;   // 这就是"当前位置"，被藏在了对象内部
};
```

用它：

```cpp
int32 Data[3] = {10, 20, 30};

for (FMyIterator It(Data); It != FMyIterator(Data + 3); ++It)
{
    UE_LOG(LogTemp, Log, TEXT("%d"), *It);
}
```

`*It` 不是"解引用指针"，而是**调用了 `It.operator*()`**；`++It` 不是"整数加一"，而是**调用了 `It.operator++()`**。编译器在背后做的就是这个替换。

现在把 `FMyIterator` 换成链表版：

```cpp
class FListIterator
{
public:
    explicit FListIterator(FNode* InNode) : Node(InNode) {}
    int32& operator*() const { return Node->Value; }
    FListIterator& operator++() { Node = Node->Next; return *this; }   // ← 只有这里变了
    bool operator!=(const FListIterator& O) const { return Node != O.Node; }
private:
    FNode* Node;
};
```

**外部的 for 循环写法一个字都不用改。** 这就是迭代器存在的全部意义 —— 把"怎么走"的差异关进容器自己的房间里。

---

## 三、两种流派：`It != End` 还是 `if (It)`？

### 流派 A：标准库风格（双迭代器）

STL 和 `TArray` 的范围 for 走这条路：容器提供 `begin()` 和 `end()`，用 `!=` 比较是否到头。

```cpp
for (auto It = Arr.begin(); It != Arr.end(); ++It) { ... }
```

前提是**你能构造出一个"末尾"的哨兵位置**。数组可以（尾后指针），链表也可以（`nullptr`）。

### 流派 B：UE 风格（自判有效性）

但有些遍历**根本造不出"末尾"这个东西**。

`TActorIterator` 就是典型：它要跨越 `UWorld` 里的多个 `ULevel`，每个 Level 有自己的 Actor 数组，还要跳过类型不匹配的、跳过正在销毁的 Actor。"末尾"是走到最后一个 Level 的最后一个有效 Actor 之后 —— 这个位置**无法提前构造出来**，只有边走边试才知道到没到。

所以 UE 换了个思路：**让迭代器自己回答"我还有效吗"**，方法是重载 `operator bool`：

```cpp
// 概念示意（引擎里在 TActorIteratorBase 中）
explicit operator bool() const { return !State->ReachedEnd; }
```

于是循环条件位置直接写迭代器本身：

```cpp
for (TActorIterator<AActor> It(World); It; ++It)
```

`for` 的条件位置是**布尔上下文**，即使转换函数标了 `explicit`，C++ 也允许在这里自动触发（这叫 *contextually converted to bool*，`if`、`while`、`for` 的条件、`&&`、`||`、`!` 都属于这类位置）。所以 `It` 会被翻译成 `It.operator bool()`。

> **判别法**：看到 `for (...; It; ++It)` 这种"条件位置只有一个迭代器"的写法，就是 UE 风格的自判有效性迭代器。

---

## 四、回到代码，逐字对照

`BaseBlueprintLibraryBPLibrary.cpp` 的 `GetAllActorsCount`：

```cpp
for (TActorIterator<AActor> It(World); It; ++It)
{
    ++Count;
}
```

| 位置 | 代码 | 实际发生了什么 |
|---|---|---|
| 初始化 | `TActorIterator<AActor> It(World)` | 构造迭代器并绑定到 `World`。**构造函数内部就已经推进到了第一个有效 Actor**（不是停在"开始前"） |
| 条件 | `It` | 调用 `It.operator bool()`，问"当前还指着一个有效 Actor 吗" |
| 步进 | `++It` | 调用 `It.operator++()`，前进到下一个**类型匹配且未被销毁**的 Actor |
| 循环体 | `++Count` | 这里没用到元素本身，纯计数。要拿 Actor 就写 `AActor* A = *It;` |

模板参数 `<AActor>` 是**类型筛选器**。因为所有 Actor 都继承自 `AActor`，写 `AActor` 等于"全都要"。

两个隐藏福利容易被忽略：

1. **自动跳过无效对象**。迭代器内部会过滤掉正在销毁 / 待 GC 的 Actor，所以 `Count` 是"当前真实存活数"，不是数组槽位数。
2. **自动跨 Level**。多个子关卡（Sublevel）的 Actor 会被无缝串起来，你不用手动遍历 `World->GetLevels()`。

---

## 五、实用举例

### 例 1：加类型筛选 —— 只数角色

```cpp
#include "GameFramework/Character.h"

int32 CharacterCount = 0;
for (TActorIterator<ACharacter> It(World); It; ++It)
{
    ++CharacterCount;
}
```

只改模板参数。`ACharacter` 的子类（比如你的 `ABP_MyCharacter`）也会被算进去。

### 例 2：真正用上元素 —— 收集名字

```cpp
TArray<FString> Names;
for (TActorIterator<AActor> It(World); It; ++It)
{
    AActor* Actor = *It;        // operator* 返回 T*，注意是【指针】不是引用
    Names.Add(Actor->GetName());

    // 也可以省掉临时变量，直接用 -> （operator-> 也被重载了）
    // Names.Add(It->GetName());
}
```

> **直觉陷阱**：`TActorIterator` 的 `operator*` 返回的是 `AActor*`（指针），不是 `AActor&`。所以 `(*It)->GetName()` 是**错的**，应该写 `It->GetName()` 或 `(*It)->` 改成先取指针再用 `->`。

### 例 3：带条件筛选 + 提前退出

```cpp
AActor* FoundActor = nullptr;
for (TActorIterator<AActor> It(World); It; ++It)
{
    if (It->ActorHasTag(TEXT("Objective")))
    {
        FoundActor = *It;
        break;              // 找到就走，不用遍历完
    }
}
```

### 例 4：范围 for 的糖衣版本（推荐日常使用）

UE 在 `EngineUtils.h` 里提供了 `TActorRange`，它就是给 `TActorIterator` 套了一层 `begin()/end()`：

```cpp
for (AActor* Actor : TActorRange<AActor>(World))
{
    ++Count;
}
```

可读性明显更好。

**什么时候还得用原始写法？** 当你需要迭代器本身提供的额外能力时（例 6 的 `RemoveCurrent` 就是），范围 for 只给你元素，拿不到迭代器。

### 例 5：TArray / TMap 的遍历（对比着看）

```cpp
TArray<AActor*> Actors;

// (a) 传统下标 —— TArray 是连续内存，完全合法且最快
for (int32 i = 0; i < Actors.Num(); ++i) { ... }

// (b) 范围 for —— 最常用，读起来最干净
for (AActor* Actor : Actors) { ... }

// (c) 显式迭代器 —— 需要索引或需要边遍历边删时用
for (auto It = Actors.CreateIterator(); It; ++It)
{
    UE_LOG(LogTemp, Log, TEXT("第 %d 个"), It.GetIndex());
}
```

`TMap` 因为底层是稀疏桶，**没有下标可用**，只能靠迭代器：

```cpp
TMap<FString, int32> Scores;
for (const TPair<FString, int32>& Pair : Scores)   // 范围 for，元素类型是键值对
{
    UE_LOG(LogTemp, Log, TEXT("%s = %d"), *Pair.Key, Pair.Value);
}
```

这正好印证了第一节的结论：**下标是数组的特权，迭代器才是通用语言。**

### 例 6：边遍历边删除 —— 迭代器最经典的用武之地

```cpp
// ❌ 错误示范：范围 for 里删元素 → 底层数组搬移，迭代器失效，行为未定义
for (AActor* Actor : Actors)
{
    if (!IsValid(Actor)) { Actors.Remove(Actor); }   // 危险
}

// ✅ 正确：用迭代器的 RemoveCurrent，它会正确调整内部索引
for (auto It = Actors.CreateIterator(); It; ++It)
{
    if (!IsValid(*It))
    {
        It.RemoveCurrent();
    }
}

// ✅ 备选：倒序下标遍历，删除不影响未访问的部分
for (int32 i = Actors.Num() - 1; i >= 0; --i)
{
    if (!IsValid(Actors[i])) { Actors.RemoveAt(i); }
}
```

---

## 六、语法使用方法总结

### 三种写法，怎么选

```cpp
// ① 范围 for —— 默认选它，只是"每个元素做点事"
for (AActor* Actor : TActorRange<AActor>(World)) { }
for (int32 N : MyArray) { }

// ② UE 自判风格 —— 迭代器不提供 begin/end 时（TActorIterator / TObjectIterator / TFieldIterator）
for (TActorIterator<AActor> It(World); It; ++It) { }
for (auto It = MyArray.CreateIterator(); It; ++It) { }   // 需要 GetIndex/RemoveCurrent 时

// ③ 标准双迭代器 —— 写模板代码或对接 STL 算法时
for (auto It = MyArray.begin(); It != MyArray.end(); ++It) { }
```

### 迭代器上你能用的操作

| 写法 | 含义 |
|---|---|
| `*It` | 取当前元素（`TActorIterator` 给的是 `AActor*`，`TArray` 给的是元素引用） |
| `It->Member` | 等价于 `(*It).Member`，直接访问成员 |
| `++It` | 前进一格。**永远优先用前置**，后置 `It++` 要先拷贝一份旧迭代器再返回，多一次构造开销 |
| `It` 放在条件位置 | UE 风格：还有效吗 |
| `It != End` | 标准风格：到头了吗 |
| `It.GetIndex()` | TArray/TMap 迭代器专有，取当前下标 |
| `It.RemoveCurrent()` | 容器迭代器专有，安全删除当前元素 |

### UE 常见迭代器速查

| 迭代器 | 头文件 | 用途 |
|---|---|---|
| `TActorIterator<T>` | `EngineUtils.h` | 遍历某个 World 里的 Actor |
| `TActorRange<T>` | `EngineUtils.h` | 上面那个的范围 for 封装 |
| `TObjectIterator<T>` | `UObject/UObjectIterator.h` | 遍历内存中**所有** UObject（含 CDO，很慢，多用于编辑器工具） |
| `TFieldIterator<T>` | `UObject/UnrealType.h` | 遍历某个 UClass 的属性/函数（反射） |
| `TArray::CreateIterator()` | `Containers/Array.h` | 需要索引或删除时 |

---

## 七、必须避开的坑

1. **迭代器失效**
   遍历期间往容器里 `Add`/`Remove`，或者在 `TActorIterator` 循环里 `SpawnActor`/`Destroy`，会让内部位置错乱。
   正确做法：先把目标收集进一个 `TArray`，循环结束后统一处理。

2. **`*It` 的类型别猜**
   `TActorIterator` 给指针，`TArray` 迭代器给引用。不确定时用 `auto`，或者鼠标悬停看 IDE 提示。

3. **`TActorIterator` 不要放进 Tick**
   这是全场景线性遍历。补充一点：`UGameplayStatics::GetAllActorsOfClass` 内部同样是遍历，**性能上并不更优**，它只是帮你装进了 `TArray`。真要高频按类型取 Actor，得自己在 `BeginPlay`/`EndPlay` 里维护注册表。

4. **`explicit operator bool` 只在条件位置自动生效**
   `for (...; It; ...)` 可以，但 `bool b = It;` 编译不过，得写 `static_cast<bool>(It)`。

---

## 一句话收尾

传统 `for` 的 `i` 是"数组的下标"，而迭代器的 `It` 是"任意容器的当前位置"。前者是后者在连续内存这个特例上的简化版。

`for (TActorIterator<AActor> It(World); It; ++It)` 翻译成人话就是——

> **从世界的第一个 Actor 开始，只要还没走完，就往下一个走。**

---

*相关代码：`Plugins/BaseBlueprintLibrary/Source/BaseBlueprintLibrary/Private/BaseBlueprintLibraryBPLibrary.cpp` → `GetAllActorsCount()`*
