/**
 * 纯函数层：拼参数、解进程表、比对名字、拼提权命令。
 * 不碰进程与文件，方便单独测——World 只负责把结果包成回执。
 */

/** BetterGI 命令行支持的三种动作（`bettergi://` 协议只覆盖前两种）。 */
export type RunMode = 'start' | 'oneDragon' | 'groups';

export interface RunArgsInput {
  mode: RunMode;
  /** 一条龙配置名；留空 = 用界面上选定的那个。 */
  configName?: string;
  /** 调度器配置组名，按书写顺序执行。 */
  groups?: string[];
}

export interface RunArgsResult {
  args: string[];
  /** 参数不成立时的说明；有它就说明别执行。 */
  problem?: string;
  /** 能跑但要注意的事（例如配置名未知会回退）。 */
  notes: string[];
}

/**
 * 拼 BetterGI 的参数。
 * 依据官方文档：`start`、`startOneDragon [配置名]`、`--startGroups <组名...>`。
 */
export function buildRunArgs(input: RunArgsInput): RunArgsResult {
  const notes: string[] = [];
  const groups = (input.groups ?? []).map((g) => g.trim()).filter((g) => g !== '');

  if (input.mode === 'start') {
    return { args: ['start'], notes };
  }

  if (input.mode === 'oneDragon') {
    const name = (input.configName ?? '').trim();
    if (name === '') return { args: ['startOneDragon'], notes };
    if (name.startsWith('-')) return { args: [], problem: `配置名不能以 - 开头：${name}`, notes };
    return { args: ['startOneDragon', name], notes };
  }

  if (input.mode === 'groups') {
    if (groups.length === 0) {
      return { args: [], problem: 'mode=groups 需要至少一个配置组名（先用 bettergi_list 看有哪些）', notes };
    }
    const bad = groups.filter((g) => g.startsWith('-'));
    if (bad.length > 0) return { args: [], problem: `配置组名不能以 - 开头：${bad.join('、')}`, notes };
    return { args: ['--startGroups', ...groups], notes };
  }

  return { args: [], problem: `未知的 mode：${String((input as { mode?: unknown }).mode)}`, notes };
}

/** 这条参数能不能用 URL 协议表达（官方只支持 start 与 startOneDragon）。 */
export function protocolUrl(input: RunArgsInput): string | null {
  if (input.mode === 'start') return 'bettergi://start';
  if (input.mode === 'oneDragon' && (input.configName ?? '').trim() === '') {
    return 'bettergi://startOneDragon';
  }
  return null;
}

export interface ProcEntry {
  name: string;
  pid: number;
}

/**
 * 解 `tasklist /FO CSV /NH` 的输出。
 * 没有匹配时 tasklist 打的是中文提示句，这里一并当成空表。
 */
export function parseTasklist(text: string): ProcEntry[] {
  const rows: ProcEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.match(/"([^"]*)"/g);
    if (!cols || cols.length < 2) continue;
    const name = cols[0]!.slice(1, -1);
    const pid = Number(cols[1]!.slice(1, -1));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    rows.push({ name, pid });
  }
  return rows;
}

export interface NameMatch {
  known: string[];
  unknown: string[];
}

/** 名字比对：先精确，再忽略大小写（Windows 文件名不区分大小写）。 */
export function matchNames(requested: readonly string[], available: readonly string[]): NameMatch {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const raw of requested) {
    const want = raw.trim();
    if (want === '') continue;
    const exact = available.find((a) => a === want);
    if (exact) {
      known.push(exact);
      continue;
    }
    const loose = available.find((a) => a.toLowerCase() === want.toLowerCase());
    if (loose) {
      known.push(loose);
      continue;
    }
    unknown.push(want);
  }
  return { known, unknown };
}

/** 把参数拼成一条可读的命令行（回执里给人看），带引号但不做转义变形。 */
export function quoteArg(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

export function renderCommand(exePath: string, args: readonly string[]): string {
  return [quoteArg(exePath), ...args.map(quoteArg)].join(' ');
}

/** PowerShell 单引号字面量：内部单引号翻倍。 */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 需要 UAC 提权时的启动命令：`Start-Process -Verb RunAs`。
 * BetterGI 要管理员权限才能模拟点击，未提权的进程直接拉起会失败。
 */
export function buildElevateCommand(exePath: string, args: readonly string[], workingDir: string): string {
  const list = args.length === 0 ? '@()' : `@(${args.map(psQuote).join(', ')})`;
  return [
    `Start-Process -FilePath ${psQuote(exePath)}`,
    `-ArgumentList ${list}`,
    '-Verb RunAs',
    `-WorkingDirectory ${psQuote(workingDir)}`,
  ].join(' ');
}
