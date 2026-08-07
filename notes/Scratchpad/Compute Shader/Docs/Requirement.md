GroupID，在整个CPU派发Group总量的中的ID，Dispatch(64,64,1)那么Group就有64*64=4096个，那么GroupID就有4096个，
ID示例([0,64], [0,64], [0,64])，GroupThreadID就是单个Group中每一个线程的ID，如numthreads(8,8,1)那么一共就有8*8*1=64个GroupThreadID，
每一个Group中ID示例([0,8], [0,8], [0,8])，GroupIndex就是当前Thread在当前Group中是第几个，比如一个Group的numthreads为(8,8,1)，
那么这个Group中GroupIndex就会是[0,63]，这个的索引会被拆分到不同的warp中，我的理解正确吗

你在仓库下单一次买了 32 件货（一条指令、32 条 lane）。货分布在几个货架（cache line），拣货员就要跑几趟（wavefront）；而每件货只能按整箱（32B sector）出库，
你要 16B 也得搬一整箱，箱子里剩下的半箱就是过取的浪费。