# cortico-world-bettergi

给 [Coopanion](https://coo.palailab.org/)（基于 [Cortico](https://github.com/Pal-AI-Lab/Cortico)）的 World 扩展：让桌宠能驱动本机的 **BetterGI（更好的原神）**——启动它、跑一条龙、按配置组跑调度器、查进程状态。

> 本扩展只是**把 BetterGI 自己的命令行参数发出去**，不读游戏内存、不改游戏文件、不模拟键鼠。真正的自动化全在 BetterGI 里配置；这里管的是「什么时候让它跑、跑哪一套」。

**第一次用、连 BetterGI 都没装？** 看 [docs/从零开始.md](docs/从零开始.md)——从下载 BetterGI 到让桌宠跑起日常的完整步骤，带自检点和排错表。

## 它给 Coo 的工具

| 工具 | 作用 |
|---|---|
| `bettergi_status` | BetterGI 是否在跑、当前进程有没有提权、exe 与用户目录在哪、配置组几个、游戏在不在 |
| `bettergi_list` | 列出调度器**配置组**名与**一条龙配置**名（就是 `User\ScriptGroup`、`User\OneDragon` 下的文件名） |
| `bettergi_run` | `start` / `oneDragon [配置名]` / `groups [组名...]`；支持 `dryRun` 只演算、`restartIfRunning` 先关再起、`force` 跳过名字校验 |
| `bettergi_stop` | 先礼后兵：优雅关闭，超时强杀 |

## 用法（对 Coo 说人话）

- 「帮我把原神日常跑一下」→ 它会先 `bettergi_list` 拿真实组名，再 `bettergi_run {mode:'groups', groups:[...]}`。
- 「现在 BetterGI 在跑吗 / 原神开了吗」→ `bettergi_status`。
- 「先看看它准备发什么命令」→ `dryRun: true`，只回显命令行，不启动。
- 「关掉 BetterGI」→ `bettergi_stop`。

## 配置（`worlds.bettergi`）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 装上不会自己生效，要在 World 总览里启用 |
| `exePath` | `C:\Program Files\BetterGI\BetterGI.exe` | 主程序路径 |
| `userDir` | `''` | 空串 = `<exe 所在目录>\User` |
| `launchTimeoutMs` | `20000` | 启动后等进程出现多久算超时 |
| `allowStop` | `true` | 关掉后 `bettergi_stop` 只报告不动手 |
| `stopGraceMs` | `5000` | 优雅关闭等多久，超时才强杀 |

## 设计上的几个判断

1. **名字先校验**：调度器组名拼错会让 BetterGI 静默什么都不做——比报错更难查，所以工具先跟 `User\ScriptGroup` 下的文件比对，对不上就拦住并把现有名字列出来。一条龙配置名对不上只提示（官方文档说有回退）。
2. **单实例**：BetterGI 已经在跑时再启动一个不会执行参数。这时 `start` 与「不带配置名的一条龙」走 `bettergi://` 协议交给在跑的实例；带配置名的任务和 `--startGroups` 没有协议版本（官方明说），只能 `restartIfRunning` 或先关再发。
3. **提权**：BetterGI 要管理员权限才能模拟点击。当前进程没提权时，工具用 `Start-Process -Verb RunAs` 走 UAC；UAC 被点掉进程不会出现，回执会说「没看到进程起来」，不会假装成功。
4. **不走 cmd**：官方文档说「用命令提示符而不是 PowerShell」，那是指手工敲命令的路径依赖；这里直接 `spawn(exe, args, {cwd})`，等价且不用操心引号转义。

## 从本机目录装进 Coopanion

1. 在包目录里装依赖并跑测试：

   ```bash
   corepack pnpm install
   pnpm typecheck && pnpm test
   ```

2. Coopanion → 高级模式 → 扩展 → 手动安装 → 选本机目录，填这个包的**绝对路径**（link 方式）。
3. 「重启进程」，到 World 总览启用 `BetterGI`。
4. 先在配置里确认 `exePath` 指向真的 `BetterGI.exe`，再让 Coo 调 `bettergi_status` 验一遍。

## 开发

```bash
corepack pnpm install
pnpm typecheck
pnpm test                                       # vitest run --no-file-parallelism
pnpm exec tsx scripts/gen-describe.ts           # 改了工具或提示词后重新生成 describe.json
```

## 已知限制

- **看不到任务进度**：BetterGI 没有查询接口，跑到哪、有没有卡住只能看它界面里的日志。回执只说「命令发出去了、进程起来了」。
- **不能逐项开关功能**：命令行只覆盖 `start` / `oneDragon` / `--startGroups` 三种动作，没有「只开自动拾取」这种参数。
- **`--TaskProgress` 未接入**：本机 0.66.0 的程序里存在这个 token，但文档未记载、语义未验证，所以没做成工具。
- **中文组名**：Windows 文件名与参数都支持中文，但极老的系统代码页环境下可能出问题（未验证）。
- 桌面分身还开着时 BetterGI 会拒绝退出，`bettergi_stop` 会如实报「还有 PID 没退」并给出处理办法。

## 文件

| 文件 | 内容 |
|---|---|
| `src/definition.ts` | `WorldDefinition`：id、label、默认配置、`create()`、`describe` |
| `src/config.ts` | 配置段类型、默认值、WebUI 配置组 |
| `src/world.ts` | `World` 实现：四个工具、进程探查、启动/关闭 |
| `src/bettergi.ts` | 纯函数：拼参数、解 tasklist、名字比对、提权命令 |
| `src/ENV_PROMPT.md` | 环境提示词模板，`{{bettergi.*}}` 由 `envPromptVars()` 报值 |
| `tests/` | 干装载、参数拼装、名字校验、回执格式、describe 一致性 |

## 许可与来源

MIT，见 [LICENSE](LICENSE)。

包结构与 `WorldDefinition` 骨架取自 [Pal-AI-Lab/Cortico](https://github.com/Pal-AI-Lab/Cortico) 的 `templates/extension/world`（MIT）。BetterGI 的命令行语法来自其官方文档 <https://www.bettergi.com/feats/command/introduce.html>。除此之外没有引入第三方代码。
