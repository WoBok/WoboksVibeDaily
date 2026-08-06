// Copyright Epic Games, Inc. All Rights Reserved.

// ============================================================================
// 【文件作用】BaseBlueprintLibrary.h —— 模块的「入口类」声明
//
// 每个 UE C++ 模块（一个 DLL）都需要一个实现 IModuleInterface 的类，
// 它相当于这个 DLL 的 main()：模块被加载进内存时调用 StartupModule()，
// 卸载前调用 ShutdownModule()。
//
// 注意区分两个容易搞混的概念：
//   * 本文件的 FBaseBlueprintLibraryModule  —— 模块生命周期管理（每个模块必有）
//   * BaseBlueprintLibraryBPLibrary.h 里的 UBaseBlueprintLibraryBPLibrary
//                                        —— 真正给蓝图用的函数库（本插件的业务内容）
// 一个纯蓝图函数库插件，其实 90% 的时间只需要动后者，这个文件放着不管即可。
// ============================================================================

// #pragma once：头文件保护，防止同一个头文件被重复展开。
// UE 全代码库统一用 #pragma once，不用传统的 #ifndef 宏。
#pragma once

// FModuleManager、IModuleInterface、IMPLEMENT_MODULE 宏都来自这个头文件。
// 它属于 Core 模块，所以 Build.cs 里只依赖 "Core" 就够了。
#include "Modules/ModuleManager.h"

// 命名规范：F 前缀表示"普通 C++ 类/结构体"（非 UObject）。
//   U = UObject 派生类     A = AActor 派生类
//   F = 普通类/结构体      I = 纯接口       E = 枚举      T = 模板
// 这个类不是 UObject，不参与反射和 GC，所以用 F 开头，也没有 UCLASS() 宏。
class FBaseBlueprintLibraryModule : public IModuleInterface
{
public:

	/** IModuleInterface implementation */

	// StartupModule：模块加载完成后立刻调用。
	// 调用时机由 .uplugin 里的 "LoadingPhase" 决定（本插件是 PreLoadingScreen）。
	// 典型用途：注册控制台命令、注册资产类型、注册 Slate 样式、
	//          注册设置项（ISettingsModule）、加载配置、绑定引擎委托。
	virtual void StartupModule() override;

	// ShutdownModule：模块卸载前调用（引擎退出，或热重载 Hot Reload 时）。
	// 【重要】必须在这里把 StartupModule 注册的东西全部反注册，否则热重载后
	// 会出现重复注册、或指向已卸载 DLL 的野指针导致崩溃。
	// 规则：Startup 里 Register/Add 了什么，Shutdown 里就 Unregister/Remove 什么。
	virtual void ShutdownModule() override;
};
