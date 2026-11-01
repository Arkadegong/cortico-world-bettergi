## 0.1.0

首个版本。

- 四个工具：`bettergi_status`（进程/提权/路径/配置数量/游戏）、`bettergi_list`（配置组与一条龙配置名）、`bettergi_run`（start / oneDragon / groups）、`bettergi_stop`（先礼后兵）。
- 参数严格按官方文档：`start`、`startOneDragon [配置名]`、`--startGroups <组名...>`。
- 组名先校验：对不上就拦住并列出真实名字，避免调度器静默空转；`force` 可跳过。
- 单实例处理：已在运行时 `start` 与不带配置名的一条龙走 `bettergi://` 协议交给在跑的实例；无协议版本的指令提示改用 `restartIfRunning`。
- 提权：未提权时走 UAC（`Start-Process -Verb RunAs`），UAC 被取消时如实报「没看到进程起来」。
- `dryRun` 只回显命令行；`restartIfRunning` 先关再起。
- 配置段 `worlds.bettergi`：exePath / userDir / launchTimeoutMs / allowStop / stopGraceMs。
- `describe.json` 由 `scripts/gen-describe.ts` 生成，测试保证与代码一致。
