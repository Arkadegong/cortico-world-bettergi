/**
 * World 实现：把 BetterGI 的命令行包成模型可调的工具。
 * 回执只描述能确认的事实（进程、退出码、实际执行的命令），不替模型脑补结果。
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { BETTERGI_CONFIG_GROUP, type BetterGiConfigSection } from './config.ts';
import {
  buildElevateCommand,
  buildRunArgs,
  matchNames,
  parseTasklist,
  protocolUrl,
  renderCommand,
  type ProcEntry,
  type RunMode,
} from './bettergi.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

const EXE_NAME = 'BetterGI.exe';
const GAME_NAMES = ['YuanShen.exe', 'GenshinImpact.exe'];

export interface BetterGiWorldOptions {
  /** `worlds.bettergi` 的活引用：热改的键现读即生效。 */
  cfg: BetterGiConfigSection;
  timezone: string;
}

/** 全部工具的声明；`describe` 与 `tools()` 都从这里取，保证两边一致。 */
export const BETTERGI_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'bettergi_status',
    description:
      'Report whether BetterGI is running, whether this process is elevated, where the exe and user dir are, how many config groups exist, and whether the game is running.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: 'bettergi_list',
    description:
      'List the scheduler config group names and the one-dragon config names found under the user dir, with their file times. Use it before bettergi_run so the names are real.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: 'bettergi_run',
    description:
      'Launch BetterGI, or hand it a command: `start`, `oneDragon` (optionally with a config name), or `groups` (a list of scheduler config group names, run in order). Returns the exact command line, the PID, and how it was elevated.',
    tags: ['act'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: {
          type: 'string',
          enum: ['start', 'oneDragon', 'groups'],
          description: 'start = just launch; oneDragon = run the one-dragon flow; groups = run scheduler config groups.',
        },
        configName: { type: 'string', description: 'One-dragon config name (mode=oneDragon). Omit to use the one selected in the UI.' },
        groups: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scheduler config group names, executed in this order (mode=groups).',
        },
        dryRun: { type: 'boolean', description: 'Only show the command line that would run, do not launch anything.' },
        force: {
          type: 'boolean',
          description: 'Skip the name check for scheduler groups. Only when you are sure the name exists but is not on disk yet.',
        },
        restartIfRunning: {
          type: 'boolean',
          description: 'When BetterGI is already running: stop it first, then launch with the arguments. Defaults to false.',
        },
      },
      required: ['mode'],
    },
  },
  {
    name: 'bettergi_stop',
    description:
      'Ask BetterGI to close (graceful) and force-kill it if it does not exit within the configured grace period. Refuses when allowStop is off.',
    tags: ['act'],
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  },
];

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });
const GB18030 = new TextDecoder('gb18030');

/** 控制台程序的输出在中文系统上是 GBK；先按 UTF-8 解，解不动再回退。 */
export function decodeConsole(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  try {
    return UTF8_STRICT.decode(bytes);
  } catch {
    return GB18030.decode(bytes);
  }
}

export class BetterGiWorld implements World {
  readonly id = 'bettergi';
  private host: WorldHost | null = null;

  constructor(private readonly opts: BetterGiWorldOptions) {}

  envPromptVars(): Record<string, string> {
    const cfg = this.opts.cfg;
    return {
      'bettergi.exe': cfg.exePath,
      'bettergi.userDir': this.userDir(),
      'bettergi.launchSec': String(Math.round(this.num(cfg.launchTimeoutMs, 20_000) / 1000)),
      'bettergi.canStop': cfg.allowStop === false ? '关闭（不能结束它的进程）' : '开启（可以结束它的进程）',
    };
  }

  tools(): ToolDef[] {
    const byName = new Map(BETTERGI_TOOL_DECLS.map((d) => [d.name, d]));
    const decl = (name: string): Omit<ToolDef, 'handler'> => byName.get(name)!;
    return [
      { ...decl('bettergi_status'), handler: () => this.statusTool() },
      { ...decl('bettergi_list'), handler: () => this.listTool() },
      { ...decl('bettergi_run'), handler: (args) => this.runTool(args) },
      { ...decl('bettergi_stop'), handler: () => this.stopTool() },
    ];
  }

  webUi(): WorldWebUiDecl {
    return {
      config: [BETTERGI_CONFIG_GROUP],
      promptDocs: [
        {
          key: 'worlds.bettergi.envPrompt',
          title: 'BetterGI · 环境提示词',
          description: '本 World 进 system 前缀的那一段：能做什么、名字从哪来、什么时候该先问。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'bettergi.exe', description: 'BetterGI.exe 的绝对路径。' },
            { name: 'bettergi.userDir', description: '用户数据目录（配置组与一条龙配置所在）。' },
            { name: 'bettergi.launchSec', description: '启动后等进程出现多久算超时。' },
            { name: 'bettergi.canStop', description: '是否允许结束进程。' },
          ],
        },
      ],
    };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    host.log?.info(`bettergi: 已挂载，exe=${this.opts.cfg.exePath}`);
  }

  async stop(): Promise<void> {
    this.host = null;
  }

  // ── 环境事实 ───────────────────────────────────────────────

  private num(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private exePath(): string {
    return (this.opts.cfg.exePath ?? '').trim();
  }

  private userDir(): string {
    const custom = (this.opts.cfg.userDir ?? '').trim();
    if (custom !== '') return custom;
    const exe = this.exePath();
    return exe === '' ? '' : join(dirname(exe), 'User');
  }

  /** 读 `<userDir>\<sub>\*.json` 的文件名（不带扩展名）——配置组与一条龙配置都靠这个。 */
  private listNames(sub: string): string[] {
    const dir = join(this.userDir(), sub);
    try {
      return readdirSync(dir)
        .filter((n) => n.toLowerCase().endsWith('.json'))
        .map((n) => n.slice(0, -5))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    } catch {
      return [];
    }
  }

  private async capture(file: string, args: string[], timeoutMs = 8000): Promise<{ code: number | null; out: string }> {
    return await new Promise((resolve) => {
      execFile(
        file,
        args,
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 1 << 20, encoding: 'buffer' as never },
        (err, stdout, stderr) => {
          const chunks: Buffer[] = [];
          if (Buffer.isBuffer(stdout)) chunks.push(stdout);
          if (Buffer.isBuffer(stderr)) chunks.push(stderr);
          const out = decodeConsole(Buffer.concat(chunks)).trim();
          if (err && typeof (err as { code?: unknown }).code === 'number') {
            resolve({ code: (err as { code: number }).code, out });
            return;
          }
          resolve({ code: err ? null : 0, out });
        },
      );
    });
  }

  private async procs(imageName: string): Promise<ProcEntry[]> {
    const { out } = await this.capture('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH']);
    return parseTasklist(out).filter((p) => p.name.toLowerCase() === imageName.toLowerCase());
  }

  private async bettergiProcs(): Promise<ProcEntry[]> {
    return await this.procs(EXE_NAME);
  }

  /**
   * 当前进程是不是管理员。
   * 先看完整性级别 SID（不看文字，中文系统也不受影响）：
   * S-1-16-12288 = High、S-1-16-16384 = System，都算提权；S-1-16-8192 = Medium。
   */
  private async elevated(): Promise<boolean | null> {
    const who = await this.capture('whoami', ['/groups']);
    if (who.code === 0) {
      if (/S-1-16-(12288|16384)/.test(who.out)) return true;
      if (/S-1-16-8192/.test(who.out)) return false;
    }
    const net = await this.capture('net', ['session']);
    if (net.code === 0) return true;
    if (/拒绝访问|Access is denied|错误 5|error 5/i.test(net.out)) return false;
    return null;
  }

  // ── 工具 ──────────────────────────────────────────────────

  private async statusTool(): Promise<string> {
    const exe = this.exePath();
    const running = await this.bettergiProcs();
    const elevated = await this.elevated();
    const games = (await Promise.all(GAME_NAMES.map((n) => this.procs(n)))).flat();
    const groups = this.listNames('ScriptGroup');
    const dragons = this.listNames('OneDragon');

    const lines = ['状态: ok'];
    lines.push(
      running.length === 0
        ? '进程: BetterGI.exe 未运行'
        : `进程: BetterGI.exe 运行中 · ${running.map((p) => `PID ${p.pid}`).join(' · ')}`,
    );
    lines.push(
      elevated === true
        ? '提权: 当前进程已提权（能直接拉起 BetterGI 并模拟点击）'
        : elevated === false
          ? '提权: 当前进程未提权 —— 拉起 BetterGI 会走 UAC 提权；若 UAC 被拒，模拟点击会失效'
          : '提权: 无法判定（net session 返回了意外结果）',
    );
    lines.push(
      exe === ''
        ? '路径: 未配置 exePath'
        : `路径: ${exe}${existsSync(exe) ? '（存在）' : '（不存在 —— 去 worlds.bettergi.exePath 改）'}`,
    );
    lines.push(`用户目录: ${this.userDir() || '（未配置）'}`);
    lines.push(`配置: 调度器配置组 ${groups.length} 个 · 一条龙配置 ${dragons.length} 个`);
    lines.push(
      games.length === 0 ? '游戏: 未检测到原神进程' : `游戏: ${games.map((g) => `${g.name} PID ${g.pid}`).join(' · ')}`,
    );
    if (running.length > 0 && games.length === 0) {
      lines.push('提示: BetterGI 在跑但游戏没启动；多数功能要有游戏窗口才有意义。');
    }
    return lines.join('\n');
  }

  private async listTool(): Promise<string> {
    const groups = this.listNames('ScriptGroup');
    const dragons = this.listNames('OneDragon');
    const lines = [`状态: ok · 用户目录 ${this.userDir() || '（未配置）'}`];
    lines.push(
      groups.length === 0
        ? '调度器配置组: 无（界面「全自动 → 调度器」里建一个，或用一条龙）'
        : `调度器配置组（${groups.length}）: ${groups.join('、')}`,
    );
    lines.push(
      dragons.length === 0
        ? '一条龙配置: 无（界面「一条龙」页保存一次就有）'
        : `一条龙配置（${dragons.length}）: ${dragons.join('、')}`,
    );
    lines.push('名字就是文件名（不带 .json），大小写与空格都要对上。');
    return lines.join('\n');
  }

  private async runTool(args: Record<string, unknown>): Promise<string> {
    const exe = this.exePath();
    if (exe === '') return '状态: blocked · 没配置 worlds.bettergi.exePath，不知道该启动哪个程序。';
    if (!existsSync(exe)) return `状态: blocked · 找不到 ${exe}，去 worlds.bettergi.exePath 改路径。`;

    const mode = String(args.mode ?? '') as RunMode;
    const configName = typeof args.configName === 'string' ? args.configName : '';
    const groups = Array.isArray(args.groups) ? args.groups.map((g) => String(g)) : [];
    const built = buildRunArgs({ mode, configName, groups });
    if (built.problem) return `状态: blocked · ${built.problem}`;

    // 名字先对一遍：不存在的组名会让调度器静默什么都不做，比报错更难查。
    const notes = [...built.notes];
    let finalArgs = built.args;
    if (mode === 'groups') {
      const match = matchNames(groups, this.listNames('ScriptGroup'));
      if (match.unknown.length > 0 && args.force !== true) {
        const available = this.listNames('ScriptGroup');
        return [
          '状态: blocked · 这些配置组不存在：' + match.unknown.join('、'),
          `现有配置组（${available.length}）：${available.join('、') || '（一个都没有）'}`,
          '名字要跟 User\\ScriptGroup 下的文件名一致（不带 .json）。确认无误可带 force=true 强行发出去。',
        ].join('\n');
      }
      if (match.unknown.length > 0) {
        notes.push(`这些组名在 User\\ScriptGroup 里找不到，已按 force 原样发出：${match.unknown.join('、')}`);
        finalArgs = ['--startGroups', ...groups.map((g) => g.trim()).filter((g) => g !== '')];
      } else {
        finalArgs = ['--startGroups', ...match.known];
      }
    }
    if (mode === 'oneDragon' && configName.trim() !== '') {
      const match = matchNames([configName], this.listNames('OneDragon'));
      if (match.unknown.length > 0) {
        notes.push(`一条龙配置「${configName.trim()}」没找到，BetterGI 会退回界面上选定的那个。`);
      }
    }

    const command = renderCommand(exe, finalArgs);
    const cwd = dirname(exe);
    const dryRun = args.dryRun === true;

    if (dryRun) {
      return [
        '状态: ok · 只是演算，没有启动任何东西',
        `命令: ${command}`,
        `cwd: ${cwd}`,
        ...notes.map((n) => `注意: ${n}`),
      ].join('\n');
    }

    const running = await this.bettergiProcs();
    if (running.length > 0 && args.restartIfRunning !== true) {
      const url = protocolUrl({ mode, configName, groups });
      if (url !== null) {
        const opened = await this.openUrl(url);
        return [
          `状态: ${opened ? 'ok' : 'failed'} · BetterGI 已在运行（PID ${running[0]!.pid}），没有重复启动`,
          `已交给它在跑的实例: ${url}`,
          opened ? '协议调用已发出；任务是否真的开始，看界面里的日志。' : '协议调用失败：这个系统可能没注册 bettergi:// 协议。',
          ...notes.map((n) => `注意: ${n}`),
        ].join('\n');
      }
      return [
        `状态: blocked · BetterGI 已在运行（PID ${running[0]!.pid}），而「${command}」没有对应的 URL 协议`,
        '两个办法：① 带 restartIfRunning=true 先关再起；② 先用 bettergi_stop 关掉，再重发这条命令。',
        ...notes.map((n) => `注意: ${n}`),
      ].join('\n');
    }

    let stoppedPid: number | null = null;
    if (running.length > 0) {
      stoppedPid = running[0]!.pid;
      await this.stopAll();
    }

    const elevated = await this.elevated();
    const launch = await this.launch(exe, finalArgs, cwd, elevated === false);
    if (launch.error !== undefined) {
      return [`状态: failed · ${launch.error}`, `命令: ${command}`, ...notes.map((n) => `注意: ${n}`)].join('\n');
    }

    const pids = await this.waitForStart(this.num(this.opts.cfg.launchTimeoutMs, 20_000));
    const lines = [
      pids.length > 0
        ? `状态: ok · 已启动 ${EXE_NAME} PID ${pids.join(' · ')}（${Math.round(launch.elapsedMs / 100) / 10}s）`
        : `状态: failed · 命令发出去了，但 ${Math.round(this.num(this.opts.cfg.launchTimeoutMs, 20_000) / 1000)}s 内没看到进程起来`,
      `命令: ${command}`,
      `cwd: ${cwd}`,
      launch.elevated
        ? '提权: 通过 UAC 拉起（如果没有弹窗，说明 UAC 被系统设置直接放行或拒绝）'
        : '提权: 当前进程已提权，直接拉起',
    ];
    if (stoppedPid !== null) lines.push(`先关了在跑的实例 PID ${stoppedPid}（你要求 restartIfRunning）`);
    if (launch.elevated) lines.push('提示: 若 UAC 被取消，进程不会出现，重试前请先把弹窗点掉。');
    lines.push(...notes.map((n) => `注意: ${n}`));
    lines.push('下一步: 用 bettergi_status 看进程与游戏是否都在；任务本身的状态只能看 BetterGI 界面里的日志。');
    return lines.join('\n');
  }

  private async stopTool(): Promise<string> {
    if (this.opts.cfg.allowStop === false) {
      return '状态: blocked · 配置里关了 allowStop，这里只报告不结束进程。';
    }
    const running = await this.bettergiProcs();
    if (running.length === 0) return `状态: ok · ${EXE_NAME} 本来就没在跑。`;

    const before = running.map((p) => p.pid);
    const forced = await this.stopAll();
    const left = await this.bettergiProcs();
    if (left.length === 0) {
      return [
        `状态: ok · 已结束 PID ${before.join(' · ')}${forced ? '（优雅关闭超时，已强杀）' : '（优雅关闭）'}`,
      ].join('\n');
    }
    return [
      `状态: failed · 还有 PID ${left.map((p) => p.pid).join(' · ')} 没退`,
      '常见原因：桌面分身还开着（BetterGI 在分身在跑时会拒绝退出），或进程以更高权限运行。',
      '处理：在 BetterGI 界面里先关掉桌面分身，或用任务管理器结束；也可以再调一次 bettergi_stop。',
    ].join('\n');
  }

  // ── 进程操作 ───────────────────────────────────────────────

  /** 优雅关闭 → 等 grace → 还在就强杀。返回是否用了强杀。 */
  private async stopAll(): Promise<boolean> {
    const grace = this.num(this.opts.cfg.stopGraceMs, 5_000);
    const running = await this.bettergiProcs();
    for (const p of running) await this.capture('taskkill', ['/PID', String(p.pid)]);
    if (grace > 0) await sleep(Math.min(grace, 15_000));
    const left = await this.bettergiProcs();
    for (const p of left) await this.capture('taskkill', ['/PID', String(p.pid), '/T', '/F']);
    return left.length > 0;
  }

  private async launch(
    exe: string,
    args: string[],
    cwd: string,
    viaUac: boolean,
  ): Promise<{ error?: string; elevated: boolean; elapsedMs: number }> {
    const started = Date.now();
    if (viaUac) {
      const script = buildElevateCommand(exe, args, cwd);
      const err = await this.spawnDetached('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], cwd);
      return { ...(err ? { error: err } : {}), elevated: true, elapsedMs: Date.now() - started };
    }
    const err = await this.spawnDetached(exe, args, cwd);
    return { ...(err ? { error: err } : {}), elevated: false, elapsedMs: Date.now() - started };
  }

  private async spawnDetached(file: string, args: string[], cwd: string): Promise<string | undefined> {
    return await new Promise((resolve) => {
      let settled = false;
      const done = (err?: string): void => {
        if (settled) return;
        settled = true;
        resolve(err);
      };
      try {
        const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', (e: NodeJS.ErrnoException) => {
          const needAdmin = /740|elevation|EPERM|EACCES/i.test(`${e.code ?? ''}${e.message}`);
          done(
            needAdmin
              ? `拉起失败：需要管理员权限（${e.code ?? 'EPERM'}）。请以管理员身份运行 Coopanion，或确认 UAC 弹窗被允许。`
              : `拉起失败：${e.message}`,
          );
        });
        child.unref();
        // 进程起来了就立刻返回；GUI 程序不会自己退出，不能等它。
        setTimeout(() => done(), 400);
      } catch (e) {
        done(`拉起失败：${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  /** 轮询等进程出现，最多等 launchTimeoutMs。 */
  private async waitForStart(timeoutMs: number): Promise<number[]> {
    const deadline = Date.now() + Math.max(1000, timeoutMs);
    let last: number[] = [];
    while (Date.now() < deadline) {
      await sleep(500);
      const procs = await this.bettergiProcs();
      last = procs.map((p) => p.pid);
      if (last.length > 0) return last;
    }
    return last;
  }

  /** 用协议把指令交给已在运行的实例（rundll32 不需要 cmd 的 start）。 */
  private async openUrl(url: string): Promise<boolean> {
    const err = await this.spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url], process.cwd());
    return err === undefined;
  }
}
