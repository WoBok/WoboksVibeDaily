我现在需要一份Compute Shader的笔记文档，
1. 说明Dispatch(gx, gy, gz)（CPU 端）和 [numthreads(X, Y, Z)]（Shader 端），讲清楚两者的关系，如何配合完成一个任务
2. 讲清楚SV_DispatchThreadID，SV_GroupID，SV_GroupThreadID，SV_GroupIndex是怎么来的或怎么计算得来的，交互中也要能体现出来
3. 给出交互示例，进行展示不同Dispatch和numthreads得到的结果
4. 讲清楚Threads Group，Thread，怎么送入SM进行处理的，怎么进行warp划分，讲清楚warp是什么，如何驻留等
5. 讲清楚哪些限制了wrap的驻留，warp 槽位，block 槽位，寄存器堆，共享内存这些会影响对吧，这个应该是占用率（occupancy）对吧，这里的block起始就是指的线程组对吧，容易误解也要说清楚
6. 要讲清楚warp的形状如何决定了访问效率，这个应该叫Memory Coalescing（内存合并 / 合并访存）对吧，讲清楚warp中每次只能访问32B的sector，每次派发32lane同时访问32个地址，讲清楚不同的形状如何影响内存访问，讲清楚什么lane什么是sector
我所讲到的这些尽可能给出必要的图示或交互，讲清楚这些概念，给出必要的举例，我的目的是为了理解Compute Shader如何运作，在保证可以很好的理解这些概念的前提下表达尽可能精炼，保留必要核心点，简洁明了，通俗易懂
https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf?utm_source=chatgpt.com 文档中设计的参数参考，以最新的Blackwell作为参考，比如warp限制等
文档中不需要有专门的容易误解这种说明，直接在容易误解，也就是可能有多种说法，比如block代表thread group的话就在后面简要说明即可
https://wobok.tech/#/article/notes%2F0x0%20-%20Inbox%2FGB202%20GPU%20%E4%BA%A4%E4%BA%92%E5%BC%8F%E6%9E%B6%E6%9E%84%E5%9B%BE.html 如果需要说明GPU架构，如SM是什么等，可以引用这个网页，给出链接，让用户查看
给我一份HTML文档，要求简洁大气，符合Compute Shader的风格，有设计感