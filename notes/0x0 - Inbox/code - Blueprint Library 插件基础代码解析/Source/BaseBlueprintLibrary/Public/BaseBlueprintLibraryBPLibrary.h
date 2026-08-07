// Copyright Epic Games, Inc. All Rights Reserved.

// ============================================================================
// 【文件作用】BaseBlueprintLibraryBPLibrary.h —— 本插件的核心：蓝图函数库声明
//
// 这是整个插件里唯一"有业务价值"的文件。它做的事情是：
//   把 C++ 的静态函数，暴露成蓝图编辑器里可以右键搜到、可以连线的节点。
//
// 工作原理（理解这条链路，你就懂 UE 的反射系统了）：
//   1. 你写下 UCLASS() / UFUNCTION() 这些宏
//   2. 编译前，UHT（UnrealHeaderTool）扫描所有含 #include "XXX.generated.h" 的头文件，
//      解析这些宏，生成两个文件（就在你的 Intermediate/Build/.../UHT/ 目录里）：
//        - BaseBlueprintLibraryBPLibrary.generated.h  : 宏展开需要的样板声明
//        - BaseBlueprintLibraryBPLibrary.gen.cpp      : 反射信息注册 + 蓝图调用的"胶水函数"
//          （里面有个 execBaseBlueprintLibrarySampleFunction，负责从蓝图虚拟机的
//            栈上取参数、调用你的 C++ 函数、把返回值写回栈）
//   3. DLL 加载时，这些反射信息注册进 UClass，蓝图编辑器就能列出你的节点了
//
// 【为什么用 UBlueprintFunctionLibrary？】
//   它的所有函数都是 static，蓝图调用时不需要一个"对象实例"，
//   所以节点上没有 Target 引脚，可以在任何蓝图（Actor/Widget/AnimBP/关卡蓝图）里直接用。
//   这是做工具函数、数学库、封装第三方 SDK 的标准做法。
// ============================================================================

#pragma once

// UBlueprintFunctionLibrary 基类的声明，属于 Engine 模块。
// "Kismet" 是蓝图系统的历史代号（UE3 时代的可视化脚本叫 Kismet），
// 所以你会看到 Kismet/GameplayStatics.h、Kismet/KismetMathLibrary.h 等等。
#include "Kismet/BlueprintFunctionLibrary.h"

// 【必须是最后一个 include】UHT 生成的头文件。
// 名字规则固定：本文件名 + ".generated.h"。
// 它内部会定义 GENERATED_UCLASS_BODY / GENERATED_BODY 展开所需的宏
// （构造函数声明、StaticClass()、exec 函数声明等）。
// 如果放在其他 include 前面，会报 "#include found after .generated.h" 的编译错误。
#include "BaseBlueprintLibraryBPLibrary.generated.h"

// 前向声明：下面的示例函数用到了 AActor*，指针只需要知道"有这个类"即可，
// 不必在头文件里 #include "GameFramework/Actor.h"（那会显著拖慢编译）。
// 真正用到 AActor 的成员时（在 .cpp 里）再 include 完整定义。
class AActor;

/*
*	Function library class.
*	Each function in it is expected to be static and represents blueprint node that can be called in any blueprint.
*
*	When declaring function you can define metadata for the node. Key function specifiers will be BlueprintPure and BlueprintCallable.
*	BlueprintPure - means the function does not affect the owning object in any way and thus creates a node without Exec pins.
*	BlueprintCallable - makes a function which can be executed in Blueprints - Thus it has Exec pins.
*	DisplayName - full name of the node, shown when you mouse over the node and in the blueprint drop down menu.
*				Its lets you name the node using characters not allowed in C++ function names.
*	CompactNodeTitle - the word(s) that appear on the node.
*	Keywords -	the list of keywords that helps you to find node when you search for it using Blueprint drop-down menu.
*				Good example is "Print String" node which you can find also by using keyword "log".
*	Category -	the category your node will be under in the Blueprint drop-down menu.
*
*	For more info on custom blueprint nodes visit documentation:
*	https://wiki.unrealengine.com/Custom_Blueprint_Node_Creation
*/
// ---- 上面这段官方注释的中文翻译与补充 -------------------------------------
//	函数库类。里面每个函数都应该是 static 的，每个函数对应一个可在任意蓝图中调用的节点。
//
//	常用 UFUNCTION 说明符（specifier）：
//	  BlueprintCallable  : 生成【带执行引脚】的节点（白色箭头 Exec 引脚），
//	                       表示这是个"动作"，会改变世界状态，必须挂在执行流上。
//	  BlueprintPure      : 生成【无执行引脚】的节点（纯函数，绿色）。
//	                       表示"只算不改"，只要有下游节点读它的输出就会被求值。
//	                       ⚠ 陷阱：Pure 节点每次被读取都会重新执行一遍！
//	                       如果一个 Pure 节点的输出连给 3 个地方，它就会算 3 次。
//	                       所以耗时操作千万别标 Pure；也别在 Pure 里做有副作用的事。
//	  BlueprintImplementableEvent / BlueprintNativeEvent : 用于"C++ 声明、蓝图实现"，
//	                       函数库里用不到（那是给 Actor/Component 的）。
//
//	常用 meta 元数据：
//	  DisplayName       : 节点在编辑器里显示的完整名字，可以用 C++ 不允许的字符（空格、中文）。
//	  CompactNodeTitle  : 把节点显示成"紧凑模式"（一个小方块），上面只写这几个字符。
//	                      经典例子：加法节点上的 "+"、取反节点上的 "NOT"。
//	  Keywords          : 搜索关键字。比如引擎的 Print String 节点，输入 "log" 也能搜到。
//	  ToolTip           : 鼠标悬停提示（不写的话，UHT 会自动把函数上方的 /** */ 注释当成 ToolTip）。
//	  WorldContext      : 指定哪个参数用来获取 UWorld，见下面 GetAllActorsCount 的示例。
//	  AdvancedDisplay   : 把指定参数收进节点下方的小箭头里（默认折叠）。
//	  DeprecatedFunction: 标记为废弃，蓝图里用到它会出编译警告。
//
//	Category : 决定节点在右键菜单里的分类路径，可以用 "|" 分层，例如
//	           Category = "MyPlugin|Math"  →  菜单里是 MyPlugin 下的 Math 子菜单。
// ---------------------------------------------------------------------------

// UCLASS()：告诉 UHT "请为这个类生成反射信息"。括号里可以写类说明符，例如：
//   UCLASS(BlueprintType)  —— 让这个类型本身能作为蓝图变量
//   UCLASS(meta=(BlueprintThreadSafe)) —— 允许在动画蓝图线程安全更新里调用
// 函数库不需要被实例化，所以这里空着即可。
//
// 【进阶】类名前没有 BASEBLUEPRINTLIBRARY_API 宏，意味着这个类不从 DLL 导出，
// 别的 C++ 模块无法链接调用它（但蓝图完全不受影响，因为蓝图走的是反射调用）。
// 如果你希望别的 C++ 模块也能 include 并调用，就写成：
//   class BASEBLUEPRINTLIBRARY_API UBaseBlueprintLibraryBPLibrary : public ...
// 那个宏由 UBT 根据模块名自动定义（编译本模块时 = dllexport，其他模块 = dllimport）。
UCLASS()
class UBaseBlueprintLibraryBPLibrary : public UBlueprintFunctionLibrary
{
	// GENERATED_UCLASS_BODY()：UHT 展开点，插入反射所需的样板代码。
	// 它和 GENERATED_BODY() 的区别：
	//   GENERATED_UCLASS_BODY() —— 老写法，自动在这里插入 public: 和一个
	//        「UBaseBlueprintLibraryBPLibrary(const FObjectInitializer&)」构造函数【声明】，
	//        所以你【必须】在 .cpp 里实现这个构造函数，否则链接报错。
	//   GENERATED_BODY()        —— 新写法，不强制构造函数签名，
	//        后面要自己写 public:，构造函数用默认的 UBaseBlueprintLibraryBPLibrary();
	// 插件模板用的是前者，所以 .cpp 里那个看似"空的没用的"构造函数是不能删的。
	GENERATED_UCLASS_BODY()

	// ------------------------------------------------------------------
	// 【模板自带的示例函数】
	// 生成的节点：带执行引脚，名字显示为 "Execute Sample function"，
	// 位于右键菜单的 "BaseBlueprintLibraryTesting" 分类下，
	// 有一个 float 输入引脚 Param、一个 float 返回值引脚。
	//
	// 逐个说明符：
	//   BlueprintCallable  → 有 Exec 引脚
	//   DisplayName        → 节点显示名（注意不是 C++ 函数名）
	//   Keywords           → 搜 "sample"、"test" 都能找到它
	//   Category           → 菜单分类
	// 【注意】这里 Category 写在了 meta=() 的外面，是 UFUNCTION 的说明符，写法正确。
	//        初学者常见的错误是把它写进 meta 里，那样会不生效。
	//
	// 函数体在 .cpp 里直接 return -1;，纯占位，用来验证"插件通了"。
	// ------------------------------------------------------------------
	UFUNCTION(BlueprintCallable, meta = (DisplayName = "Execute Sample function", Keywords = "BaseBlueprintLibrary sample test testing"), Category = "BaseBlueprintLibraryTesting")
	static float BaseBlueprintLibrarySampleFunction(float Param);


	// ==================================================================
	// 以下是【教学示例】：演示四种最常见的节点写法。
	// 都是可以直接编译运行的，学完之后不需要可以整段删掉（记得连 .cpp 里的实现一起删）。
	// ==================================================================

	/**
	 * 示例 1 —— 纯函数 + 紧凑节点。
	 *
	 * BlueprintPure 让节点没有执行引脚（绿色纯函数节点）。
	 * CompactNodeTitle = "+" 让节点收缩成一个只显示 "+" 的小方块，
	 * 这就是引擎里加法节点长那样的原因。
	 *
	 * 你现在读的这种文档块注释，会被 UHT 自动提取成节点的 ToolTip，
	 * @param / @return 会分别变成对应引脚的悬停提示 —— 这是给自己写文档最省事的方式。
	 *
	 * @param A  第一个加数
	 * @param B  第二个加数
	 * @return   两数之和
	 */
	UFUNCTION(BlueprintPure, meta = (DisplayName = "Add Two Floats (Demo)", CompactNodeTitle = "+", Keywords = "add plus sum 加法"), Category = "BaseBlueprintLibrary|Math")
	static float AddTwoFloats(float A, float B);

	/**
	 * 示例 2 —— 带执行引脚 + 默认参数值。
	 *
	 * 在屏幕左上角打印一行调试文字（等价于蓝图的 Print String，但可以自己扩展）。
	 *
	 * 参数默认值的写法就是普通 C++ 默认参数：Duration = 2.0f。
	 * UHT 会把它读出来，填进蓝图节点的引脚默认框里，用户不连线就用这个值。
	 * ⚠ UHT 的默认值解析器只认得简单字面量（数字、true/false、字符串、
	 *   以及少数结构体常量），复杂表达式请留空，在函数体里判断。
	 *
	 * @param Message   要打印的内容
	 * @param Duration  停留秒数
	 */
	UFUNCTION(BlueprintCallable, meta = (DisplayName = "Print Debug Message (Demo)", Keywords = "print log debug 打印"), Category = "BaseBlueprintLibrary|Debug")
	static void PrintDebugMessage(const FString& Message, float Duration = 2.0f);

	/**
	 * 示例 3 —— 输出参数（蓝图的"多返回值"）。
	 *
	 * C++ 里用【非 const 引用】的参数，在蓝图节点上会显示成【输出引脚】。
	 * 所以这个节点右边会有两个输出：bool 返回值 + float OutDistance。
	 * 这是 UE 里 "TryGetXXX" 模式的标准写法：返回 bool 表示成功与否，
	 * 数据通过 out 参数带出，蓝图里再接一个 Branch 判断。
	 *
	 * 注意输入参数用的是 const AActor*（const 指针 → 输入引脚），
	 * 不加 const 的指针也是输入引脚，但加 const 能表明"我不会改它"，是好习惯。
	 *
	 * @param ActorA       起点 Actor
	 * @param ActorB       终点 Actor
	 * @param OutDistance  【输出】两者世界坐标的距离；失败时为 0
	 * @return             两个 Actor 都有效时返回 true
	 */
	UFUNCTION(BlueprintPure, meta = (DisplayName = "Try Get Actor Distance (Demo)", Keywords = "distance length 距离"), Category = "BaseBlueprintLibrary|Math")
	static bool TryGetActorDistance(const AActor* ActorA, const AActor* ActorB, float& OutDistance);

	/**
	 * 示例 4 —— WorldContext：在静态函数里拿到 UWorld。
	 *
	 * 这是函数库最重要的一个技巧。因为函数是 static 的，没有 this，
	 * 所以拿不到当前世界（编辑器里可能同时存在编辑世界、PIE 世界、预览世界）。
	 *
	 * 解决办法：声明一个 UObject* 参数，并用 meta = (WorldContext = "参数名") 标记它。
	 * 这样蓝图编译时会【自动把当前蓝图的 self 塞进去】，这个引脚在节点上是隐藏的，
	 * 用户根本看不到它 —— 引擎自带的 SpawnActor、GetAllActorsOfClass 都是这么做的。
	 *
	 * 然后在 .cpp 里用 GEngine->GetWorldFromContextObject(...) 取出 UWorld*。
	 *
	 * @param WorldContextObject  隐藏引脚，蓝图自动填入
	 * @return                    当前世界中 Actor 的总数
	 */
	UFUNCTION(BlueprintCallable, meta = (DisplayName = "Get All Actors Count (Demo)", WorldContext = "WorldContextObject", Keywords = "world actor count 数量"), Category = "BaseBlueprintLibrary|World")
	static int32 GetAllActorsCount(const UObject* WorldContextObject);
};
