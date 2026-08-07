// Copyright Epic Games, Inc. All Rights Reserved.

// ============================================================================
// 【文件作用】BaseBlueprintLibrary.cpp —— 模块入口类的实现 + 模块注册
//
// 做两件事：
//   1. 实现 StartupModule / ShutdownModule（模块的"构造/析构"）
//   2. 用 IMPLEMENT_MODULE 宏把这个类注册到引擎的模块管理器，
//      让引擎知道 "BaseBlueprintLibrary" 这个名字对应哪个 C++ 类。
//      没有这一句，DLL 编出来了引擎也加载不了它。
//
// 对于纯蓝图函数库插件，这个文件通常保持空实现就行 —— 蓝图节点的注册
// 不需要你手写代码，UHT 生成的 gen.cpp 会在 DLL 加载时自动完成。
// ============================================================================

// 包含自己的头文件。UE 编码规范：.cpp 的第一个 include 必须是它对应的 .h，
// 这样可以保证头文件是"自包含"的（自己 include 了所有需要的依赖）。
#include "BaseBlueprintLibrary.h"

// LOCTEXT_NAMESPACE：本地化（多语言）文本的命名空间。
// 在这个宏定义之后，可以用 LOCTEXT("Key", "默认英文文本") 创建一个可翻译的 FText，
// UE 的本地化工具会按 "命名空间 + Key" 来索引翻译条目。
// 本文件目前没用到 LOCTEXT，但模板保留了它，方便你以后加提示文字。
#define LOCTEXT_NAMESPACE "FBaseBlueprintLibraryModule"

void FBaseBlueprintLibraryModule::StartupModule()
{
	// This code will execute after your module is loaded into memory; the exact timing is specified in the .uplugin file per-module
	// 中文：模块被加载进内存后执行；具体时机由 .uplugin 里每个模块的 LoadingPhase 指定。
	//
	// 目前是空的 —— 蓝图函数库不需要任何启动逻辑。
	// 如果你想验证"模块确实被加载了"，可以临时加一行日志：
	//     UE_LOG(LogTemp, Warning, TEXT("BaseBlueprintLibrary StartupModule!"));
	// （需要 #include "Logging/LogMacros.h"，通常 Core 已经带了）
	// 编辑器启动时在 Output Log 里就能看到它，并且能观察到它比 Default 阶段的插件更早打印。
}

void FBaseBlueprintLibraryModule::ShutdownModule()
{
	// This function may be called during shutdown to clean up your module.  For modules that support dynamic reloading,
	// we call this function before unloading the module.
	// 中文：关闭时调用，用于清理。支持动态重载（Hot Reload / Live Coding）的模块，
	//      在卸载 DLL 之前也会先调用这个函数。
	//
	// 同样为空。要清理的东西举例：FCoreDelegates 上的绑定、注册过的控制台变量、
	// 自己 new 出来的单例、加载的第三方 DLL 句柄。
}

// 结束本地化命名空间。#define / #undef 必须成对出现，否则会污染后续被合并编译的
// 其他 .cpp（UE 会把多个 .cpp 合并成 Unity Build 一起编译，这点尤其重要）。
#undef LOCTEXT_NAMESPACE

// ----------------------------------------------------------------------------
// IMPLEMENT_MODULE(类名, 模块名)
//   第一个参数：实现了 IModuleInterface 的类
//   第二个参数：模块名，必须和 .Build.cs 文件名、.uplugin 里的 Modules.Name 完全一致
//
// 这个宏展开后会：
//   * 生成一个工厂函数并把它注册进 FModuleManager，引擎按名字就能创建模块实例
//   * 导出 DLL 的初始化符号（InitializeModule）
// 【规则】一个模块只能有一个 IMPLEMENT_MODULE。如果你的模块没有自定义入口类，
//        可以用 IMPLEMENT_MODULE(FDefaultModuleImpl, 模块名) 顶替。
// ----------------------------------------------------------------------------
IMPLEMENT_MODULE(FBaseBlueprintLibraryModule, BaseBlueprintLibrary)
