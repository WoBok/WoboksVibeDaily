// Some copyright should be here...

// ============================================================================
// 【总纲】这个文件的核心工作是什么？
//
// 一句话：用机器可执行的方式，把「模块边界」定死 —— 我对外暴露什么、我向内需要什么。
//
// 落到实处是三件事：
//   1. 找得到 —— 头文件搜索路径。Public/ 与 Private/ 由 UBT 自动加入，额外路径手写。
//   2. 链得上 —— 声明依赖哪些模块。UE 里「一个模块 = 一个 DLL」，依赖关系决定了
//                链接哪些 .lib、XXX_API 宏展开成 dllexport 还是 dllimport、
//                以及运行时的 DLL 加载顺序。漏写依赖的典型报错是链接期的
//                unresolved external symbol，而不是「找不到头文件」。
//   3. 怎么编 —— PCH 策略、Unity Build、优化级别、宏定义等编译开关。
//
// 常见误解：以为写这个文件只是「让编译器找得到代码」。那只是第 1 件事。
// 反例是 Public / Private 的区分 —— 两种写法都能让本模块编过、链上，区别在于
// Public 会「传染」给下游模块，Private 不会。这是你主动立的架构约束，
// 编译器只是替你执行。下面的 Scope 同理：它管的是「允不允许依赖」，不是「找不找得到」。
// ============================================================================

// ============================================================================
// 【文件作用】BaseBlueprintLibrary.Build.cs —— 模块的「构建规则」文件
//
// UE 不用 CMake / vcxproj 来描述工程，而是用 UBT（UnrealBuildTool，一个 C# 程序）。
// 每一个 C++ 模块（Module）必须有且只有一个 XXX.Build.cs，UBT 在编译前会：
//   1. 扫描工程与插件下所有 *.Build.cs / *.Target.cs
//   2. 把它们编译成一个「规则程序集」DLL
//   3. 反射实例化里面的 ModuleRules 子类，读取你在构造函数里填的字段
//   4. 据此生成真正的编译命令行（.rsp 文件）与链接参数
//
// 【第 2 步的细节】规则 DLL 不是「每个模块一个」，而是按「作用域（Scope）」分组，
// 名字取自 *工程名*，不是模块名。本工程实际产物是：
//      Intermediate/Build/BuildRules/TestShaderModuleRules.dll
// 它同时包含 TestShader.Build.cs、本文件、其余工程插件的 Build.cs、以及两个 .Target.cs
// （可查 同目录/TestShaderModuleRulesManifest.json 求证）。
// 引擎侧则是 Engine/Intermediate/Build/BuildRules/UE5Rules.dll 等，与工程侧分开。
//
// 【Scope：UBT 的依赖分层】见 UBT 源码 Configuration/Rules/RulesScope.cs。
// Scope 是一条「Name + Parent」的链，规则只有一条：
//      模块只能依赖 *同层或祖先层* 的模块（所以引擎模块永远无法依赖工程模块）。
// 链的构建见 RulesCompiler.cs:123-125 / 244 / 310：
//      Project -> Marketplace -> Engine Plugins -> Engine
// 注意 RulesCompiler.cs:376：Plugins/ 下的插件模块**没有独立 Scope**，
// 它与工程主模块同属 "Project" 层 —— 这正是本文件被编进 TestShaderModuleRules.dll 的原因。
// 违规时的报错点在 UEBuildTarget.cs:1631，形如：
//      Module 'A' (Engine) should not reference module 'B' (Project).
// 对本模块的实际影响：依赖 Core/CoreUObject/Engine/Slate（Engine 层，祖先）合法；
// 依赖 "TestShader"（同层）也能编过，但会让插件反向绑死宿主工程，不要这么做。
//
// 注意：改了这个文件必须重新编译（Live Coding 热重载不生效），因为 UBT 要重建规则 DLL。
// ============================================================================

// 引入 UBT 的命名空间，ModuleRules、ReadOnlyTargetRules 等类型都在这里。
using UnrealBuildTool;

// ============================================================================
// 【ModuleRules 是什么】一句话：它是一张「表单」，不是构建脚本。
//
// 1. 它是 UBT 提供的 C# 基类，本身就是一堆字段（依赖、路径、PCH 策略……）。
//    你写的这个子类，构造函数唯一的工作就是「填字段」，填完即结束。
//    它自己不编译任何东西 —— 真正调 cl.exe 的是 UBT 内部的 UEBuildModule，
//    它读取你填好的字段，翻译成编译命令行。
//
// 2. 为什么用「类 + 构造函数」而不是 json / ini？因为填表需要逻辑：
//    可以 if (Target.Platform == ...) 加不同依赖，也可以用继承复用规则。
//    这就是 UE 的「配置即代码」。
//
// 3. UBT 按名字反射找到这个类，先创建对象并预先塞好 Name / ModuleDirectory /
//    PluginDirectory / Target 等元数据，然后才调用你的构造函数。
//    所以这些属性在构造函数里可直接使用（不必自己拼路径）。
//    也正因为「按名字找」，才有了下面这条硬性规定。
//
// 4. 和 TargetRules 的分工：
//    ModuleRules —— 描述「我这一个模块」（本文件）
//    TargetRules —— 描述「这一次编译整体」（平台 / 配置 / Editor 还是 Game）
// ============================================================================

// 【硬性规定】类名必须和 .Build.cs 的文件名完全一致（这里是 BaseBlueprintLibrary），
// 也必须和 .uplugin 里 Modules 数组中的 "Name" 一致，否则 UBT 找不到模块。
public class BaseBlueprintLibrary : ModuleRules
{
	// 构造函数签名是固定写法，不能改：
	//   Target 描述「本次编译的目标」——平台(Win64/Android)、配置(Debug/Development/Shipping)、
	//   目标类型(Editor/Game/Server)，用来做条件配置，如 if (Target.Type == TargetType.Editor)。
	//   类型是 ReadOnly 的：模块只能「读」全局设定，无权修改。
	//   : base(Target) 把它交给基类，基类顺带初始化一堆默认值。
	public BaseBlueprintLibrary(ReadOnlyTargetRules Target) : base(Target)
	{
		// 预编译头（PCH）策略。
		// UseExplicitOrSharedPCHs 是官方推荐值：优先用本模块自己声明的 PCH，
		// 没有就用引擎的共享 PCH。好处是编译快、且强制你在每个 .cpp 里写全 #include，
		// 代码更"干净"（不会出现"我没 include 却能编过"的情况）。
		// 另一个常见值 PCHUsageMode.NoSharedPCHs 编译最慢，一般不用。
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

		// ---------------------------------------------------------------
		// PublicIncludePaths：本模块「对外公开」的额外头文件搜索路径。
		// 依赖本模块的其他模块也会自动获得这些搜索路径。
		// 注意：Public/ 文件夹是 UBT 自动加入的，不需要手写，所以这里通常留空。
		// 只有当你有第三方 SDK 的头文件（比如 ThirdParty/FMOD/include）才需要填。
		// ---------------------------------------------------------------
		PublicIncludePaths.AddRange(
			new string[] {
				// ... add public include paths required here ...
				// 例：Path.Combine(ModuleDirectory, "../ThirdParty/SomeSDK/include")
			}
			);


		// ---------------------------------------------------------------
		// PrivateIncludePaths：只有本模块自己能用的额外搜索路径。
		// 同样，Private/ 文件夹是自动加入的，一般留空。
		// ---------------------------------------------------------------
		PrivateIncludePaths.AddRange(
			new string[] {
				// ... add other private include paths required here ...
			}
			);


		// ---------------------------------------------------------------
		// PublicDependencyModuleNames：公开依赖。
		// 含义 = 「我的 Public/ 头文件里用到了这些模块的类型」。
		// 传递性：任何依赖 BaseBlueprintLibrary 的模块，会自动继承这些依赖。
		//
		// "Core" 是所有模块的最低依赖：提供 FString、TArray、FVector、FMath、
		// UE_LOG、FPlatformTime 这些最基础的东西（注意 Core 里没有 UObject！）。
		// ---------------------------------------------------------------
		PublicDependencyModuleNames.AddRange(
			new string[]
			{
				"Core",
				// ... add other public dependencies that you statically link with here ...
				// 常见追加项：
				//   "CoreUObject"  —— 如果你的 Public 头文件里出现 UObject/UCLASS/USTRUCT
				//   "Engine"       —— 如果你的 Public 头文件里出现 AActor/UWorld/UActorComponent
				// 【本模板的小坑】BaseBlueprintLibraryBPLibrary.h 是 Public 头文件，
				// 里面 #include 了 Kismet/BlueprintFunctionLibrary.h（属于 Engine 模块），
				// 严格来说 CoreUObject/Engine 应该放在 Public 里。目前能编过是因为
				// 只有本模块自己 include 它；如果将来别的模块要 include 这个头文件，
				// 就把 "CoreUObject" 和 "Engine" 从下面挪上来。
			}
			);


		// ---------------------------------------------------------------
		// PrivateDependencyModuleNames：私有依赖。
		// 含义 = 「只有我的 Private/*.cpp 用到这些模块」。不传递给下游模块。
		// 原则：能放 Private 就放 Private —— 减少下游模块的编译量和耦合。
		//
		//   CoreUObject : UObject 反射系统的核心。UCLASS/UPROPERTY/UFUNCTION、
		//                 Cast<>、UClass、垃圾回收（GC）、序列化都靠它。
		//   Engine      : 游戏运行时框架。AActor、UWorld、GEngine、UGameplayStatics、
		//                 组件系统、Tick、蓝图虚拟机（UBlueprintFunctionLibrary 就在这）。
		//   Slate       : UE 的自绘 UI 框架（编辑器界面、部分游戏 UI）的控件层。
		//   SlateCore   : Slate 的底层（布局、绘制图元、输入事件）。
		//                 这两个是插件模板默认带的，本插件其实没用到，
		//                 纯运行时的蓝图函数库可以安全删掉它们以加快编译。
		// ---------------------------------------------------------------
		PrivateDependencyModuleNames.AddRange(
			new string[]
			{
				"CoreUObject",
				"Engine",
				"Slate",
				"SlateCore",
				// ... add private dependencies that you statically link with here ...
			}
			);


		// ---------------------------------------------------------------
		// DynamicallyLoadedModuleNames：声明由 FModuleManager::LoadModule...() 显式加载的 C++ 模块。
		// “运行时”包括编辑器、PIE 和打包游戏运行期间；不会自动判断功能是否被使用，
		// 必须由代码主动加载。它可延迟模块初始化，减少启动开销和加载前的内存占用，
		// 但通常不减少安装包大小，加载后仍会占用内存；它也不负责贴图、蓝图等资源的按需加载。
		// 若要真正按需加载，目标模块通常还需将 LoadingPhase 设为 None。
		// 当前列表为空，因此本模块目前没有动态加载其他模块。
		// ---------------------------------------------------------------
		DynamicallyLoadedModuleNames.AddRange(
			new string[]
			{
				// ... add any modules that your module loads dynamically here ...
			}
			);
	}
}
