// Copyright Epic Games, Inc. All Rights Reserved.

// ============================================================================
// 【文件作用】BaseBlueprintLibraryBPLibrary.cpp —— 蓝图函数库的实现
//
// 头文件负责"声明有哪些节点、节点长什么样"，这个文件负责"节点按下去干什么"。
// 这里写的就是普通 C++ 代码，没有任何魔法 —— 蓝图调用的桥接工作
// 已经由 UHT 生成的 gen.cpp 全自动做好了，你不用管。
//
// 【改完代码怎么生效？】
//   只改函数体（不动 UFUNCTION 宏和签名）→ 可以用 Live Coding（Ctrl+Alt+F11）热重载。
//   增删函数 / 改参数 / 改宏          → 必须关掉编辑器，用 IDE 完整重新编译，
//                                       因为 UHT 需要重新生成反射代码。
// ============================================================================

// 第一个 include 永远是自己的头文件（保证头文件自包含）。
#include "BaseBlueprintLibraryBPLibrary.h"

// 模块头文件。这里其实用不到（本文件没用到 FBaseBlueprintLibraryModule），
// 是插件模板的固定写法，删掉也能编译通过。
#include "BaseBlueprintLibrary.h"

// ↓↓↓ 以下 include 是为下面的【教学示例】函数准备的，删示例时可一并删除 ↓↓↓
#include "Engine/Engine.h"        // GEngine 全局指针（AddOnScreenDebugMessage、GetWorldFromContextObject）
#include "GameFramework/Actor.h"  // AActor 的完整定义（头文件里只是前向声明，这里要调用它的成员函数）
#include "EngineUtils.h"          // TActorIterator —— 遍历世界里所有 Actor 的迭代器

// ----------------------------------------------------------------------------
// 构造函数。
// 因为头文件用了 GENERATED_UCLASS_BODY()，UHT 已经帮你【声明】了这个构造函数，
// 所以你必须提供【定义】，哪怕是空的，否则链接期会报 unresolved external symbol。
//
//   const FObjectInitializer& ObjectInitializer
//     是 UObject 的构造上下文，提供 CreateDefaultSubobject、SetDefaultSubobjectClass
//     等能力（在 Actor 里创建默认组件时才用得上）。
//   Super 是 UHT 自动生成的 typedef，等于父类 UBlueprintFunctionLibrary。
//     用 Super 而不是写死父类名，将来改继承关系时不用改这里。
//
// 函数库是纯静态工具类，永远不会被实例化（引擎只会创建它的 CDO 默认对象），
// 所以函数体是空的，这很正常。
// ----------------------------------------------------------------------------
UBaseBlueprintLibraryBPLibrary::UBaseBlueprintLibraryBPLibrary(const FObjectInitializer& ObjectInitializer)
: Super(ObjectInitializer)
{

}

// ----------------------------------------------------------------------------
// 模板自带的占位函数。
// 无论传入什么 Param，都返回 -1。
// 它存在的意义只有一个：让你在蓝图里搜到 "Execute Sample function" 节点、
// 拖出来打印一下，确认「插件已启用 + 模块已加载 + 反射已注册」这条链路是通的。
//
// 【建议的第一个练习】把 return -1 改成 return Param * 2;
// 然后 Ctrl+Alt+F11 触发 Live Coding，回到蓝图不用重连线，直接运行就能看到变化 ——
// 这样你能亲身体验到"函数体修改可热重载"。
// ----------------------------------------------------------------------------
float UBaseBlueprintLibraryBPLibrary::BaseBlueprintLibrarySampleFunction(float Param)
{
	return -1;
}


// ============================================================================
// 【教学示例】以下四个函数对应头文件里的示例 1~4，学完可整段删除。
// ============================================================================

// 示例 1：纯函数。函数体就是最朴素的 C++，没有任何 UE 特有的东西。
// 关键点全在头文件的 UFUNCTION 宏上（BlueprintPure + CompactNodeTitle）。
float UBaseBlueprintLibraryBPLibrary::AddTwoFloats(float A, float B)
{
	return A + B;
}

// 示例 2：带执行引脚的动作节点，往屏幕和日志各输出一份。
void UBaseBlueprintLibraryBPLibrary::PrintDebugMessage(const FString& Message, float Duration)
{
	// GEngine 是引擎全局单例指针。它在游戏运行时一定有效，
	// 但在极早期启动阶段或某些商业化流程里可能为空，所以养成判空习惯。
	if (GEngine)
	{
		// AddOnScreenDebugMessage(Key, TimeToDisplay, Color, Message)
		//   Key : 消息的唯一标识。传 -1 表示"每次都新增一条"；
		//         传一个固定的正整数（比如 0、1、2）则会【覆盖】同 Key 的旧消息，
		//         适合每帧刷新的调试信息，不会把屏幕刷爆。
		//   FColor::Cyan : 屏幕文字颜色，FColor 是 8 位整数颜色。
		GEngine->AddOnScreenDebugMessage(-1, Duration, FColor::Cyan, Message);
	}

	// UE_LOG 把信息写进 Output Log 和磁盘上的 .log 文件（Saved/Logs/）。
	//   LogTemp  : 临时日志分类。正式项目应该用 DECLARE_LOG_CATEGORY_EXTERN 自定义一个，
	//              比如 LogBaseBlueprintLibrary，方便在 Output Log 里过滤。
	//   Warning  : 日志级别（Log / Warning / Error），Warning 在输出窗口是黄色。
	//   TEXT("") : 把字面量转成宽字符（UE 内部字符串全是 TCHAR），中文必须用它包起来。
	//   %s       : FString 不能直接传给可变参数，必须用 *Message 取出内部的 TCHAR* 裸指针。
	UE_LOG(LogTemp, Warning, TEXT("[BaseBlueprintLibrary] %s"), *Message);
}

// 示例 3：输出参数 + 有效性检查。
bool UBaseBlueprintLibraryBPLibrary::TryGetActorDistance(const AActor* ActorA, const AActor* ActorB, float& OutDistance)
{
	// 先把输出参数初始化。
	// 【务必养成这个习惯】蓝图传进来的引用不保证被初始化，早退时若不赋值，
	// 蓝图那边读到的就是未定义的脏数据。
	OutDistance = 0.f;

	// IsValid() 比 (Ptr != nullptr) 更严格：它还会检查对象是否已被标记为待销毁（PendingKill）。
	// 蓝图里 Actor 被 Destroy 之后，指针可能非空但对象已失效，直接解引用会崩。
	if (!IsValid(ActorA) || !IsValid(ActorB))
	{
		return false;
	}

	// GetActorLocation() 返回 Actor 在世界空间的坐标（FVector，UE5 里是 double 精度）。
	// FVector::Dist(A, B) 计算两点欧氏距离。
	// 想省掉开方（比较距离大小时）可以用 FVector::DistSquared，性能更好。
	//
	// 强制转 float：UE5 的 FVector 是 double，而我们的输出参数是 float。
	// 不写显式转换编译器会报精度丢失警告（UE 的编译设置里警告当错误）。
	OutDistance = static_cast<float>(FVector::Dist(ActorA->GetActorLocation(), ActorB->GetActorLocation()));

	return true;
}

// 示例 4：通过 WorldContext 拿到 UWorld，再遍历世界里的 Actor。
int32 UBaseBlueprintLibraryBPLibrary::GetAllActorsCount(const UObject* WorldContextObject)
{
	// GEngine->GetWorldFromContextObject(对象, 错误处理模式)
	//   从任意一个 UObject 反查它属于哪个世界（每个 UObject 都有 Outer 链，
	//   顺着往上找就能找到 ULevel → UWorld）。
	//   EGetWorldErrorMode::ReturnNull : 找不到就返回 nullptr（我们自己判空）。
	//   EGetWorldErrorMode::LogAndReturnNull : 找不到时额外打一条错误日志。
	//   EGetWorldErrorMode::Assert : 找不到直接断言崩溃（只建议在确信必有世界时用）。
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	if (!World)
	{
		return 0;
	}

	int32 Count = 0;

	// TActorIterator<T> 遍历指定世界里所有 T 类型（含子类）的已生成 Actor。
	//   换成 TActorIterator<ACharacter> It(World) 就只数角色。
	//   写法上注意：它没有 begin/end，所以用 for(; It; ++It) 这种"条件即有效性"的写法。
	// 【性能提示】这是一次全场景线性遍历，别放在 Tick 里每帧调用。
	//   需要频繁按类型取 Actor 时，更好的做法是用 UGameplayStatics::GetAllActorsOfClass
	//   （其实内部也是遍历）或自己维护一个注册表。
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		++Count;
	}

	return Count;
}
