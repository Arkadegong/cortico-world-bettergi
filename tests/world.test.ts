import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, ToolOutcome, World } from 'cortico/core/types.ts';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { BETTERGI } from '../src/definition.ts';
import { BETTERGI_DEFAULTS } from '../src/config.ts';
import { BETTERGI_TOOL_DECLS, decodeConsole } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';

let scratch: string;
let userDir: string;
let fakeExe: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'bettergi-world-'));
  userDir = join(scratch, 'User');
  mkdirSync(join(userDir, 'ScriptGroup'), { recursive: true });
  mkdirSync(join(userDir, 'OneDragon'), { recursive: true });
  for (const name of ['每日', '活动', '关机']) {
    writeFileSync(join(userDir, 'ScriptGroup', `${name}.json`), '{}', 'utf8');
  }
  for (const name of ['默认配置', '6666']) {
    writeFileSync(join(userDir, 'OneDragon', `${name}.json`), '{}', 'utf8');
  }
  fakeExe = join(scratch, 'BetterGI.exe');
  writeFileSync(fakeExe, '', 'utf8');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const call = {} as ToolCallContext;

async function callTool(world: World, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const found = world.tools().find((t) => t.name === name);
  if (!found?.handler) throw new Error(`没有工具 ${name}`);
  const out: string | ToolOutcome = await found.handler(args, call);
  return typeof out === 'string' ? out : out.text;
}

/** 指向临时目录的 World（不会碰到真的 BetterGI）。 */
function makeWorld(extra: Record<string, unknown> = {}): World {
  const ctx = fakeWorldContext(BETTERGI, { scratchDir: scratch });
  ctx.persist({ exePath: fakeExe, userDir, ...extra });
  return BETTERGI.create(ctx);
}

describe('BetterGI World 装载与声明', () => {
  it('干装载不报失败', async () => {
    const report = await dryMountWorld(BETTERGI, { scratchDir: scratch });
    expect(report.failures).toEqual([]);
  });

  it('tools() 与 describe.tools 一一对应', () => {
    const world = makeWorld();
    const declared = (BETTERGI.describe?.tools ?? []).map((t) => t.name).sort();
    const actual = world.tools().map((t) => t.name).sort();
    expect(actual).toEqual(declared);
    expect(actual).toEqual(BETTERGI_TOOL_DECLS.map((d) => d.name).sort());
  });

  it('默认不启用', () => {
    expect(BETTERGI.defaults().enabled).toBe(false);
    expect(BETTERGI_DEFAULTS.exePath).toContain('BetterGI.exe');
  });

  it('环境提示词讲清了名字从哪来、单实例、提权与状态', () => {
    const world = makeWorld();
    const doc = world.webUi?.().promptDocs?.[0];
    const text = readFileSync(doc!.path, 'utf8');
    for (const key of ['bettergi_list', '单实例', '提权', '状态']) {
      expect(text).toContain(key);
    }
    expect(text).toContain('ScriptGroup');
  });

  it('挂载与卸载不抛错', async () => {
    const world = makeWorld();
    const host = new FakeHost();
    await world.start(host);
    await world.stop();
    expect(host.events).toEqual([]);
  });
});

describe('bettergi_list', () => {
  it('读出配置组与一条龙配置名', async () => {
    const out = await callTool(makeWorld(), 'bettergi_list');
    expect(out).toContain('每日');
    expect(out).toContain('活动');
    expect(out).toContain('默认配置');
    expect(out).toContain('6666');
    expect(out).toContain('（3）');
  });

  it('目录不存在时说清是空的', async () => {
    const ctx = fakeWorldContext(BETTERGI, { scratchDir: scratch });
    ctx.persist({ exePath: fakeExe, userDir: join(scratch, 'nope') });
    const out = await callTool(BETTERGI.create(ctx), 'bettergi_list');
    expect(out).toContain('调度器配置组: 无');
  });
});

describe('bettergi_status', () => {
  it('报路径、配置数量与提权状态', async () => {
    const out = await callTool(makeWorld(), 'bettergi_status');
    expect(out.startsWith('状态: ok')).toBe(true);
    expect(out).toContain(fakeExe);
    expect(out).toContain('调度器配置组 3 个');
    expect(out).toContain('提权:');
  });

  it('exe 不存在时点名要改配置', async () => {
    const ctx = fakeWorldContext(BETTERGI, { scratchDir: scratch });
    ctx.persist({ exePath: join(scratch, 'missing.exe'), userDir });
    const out = await callTool(BETTERGI.create(ctx), 'bettergi_status');
    expect(out).toContain('不存在');
    expect(out).toContain('exePath');
  });
});

describe('bettergi_run', () => {
  it('dryRun 只演算，给出真实名字拼成的命令', async () => {
    const out = await callTool(makeWorld(), 'bettergi_run', {
      mode: 'groups',
      groups: ['每日', '活动'],
      dryRun: true,
    });
    expect(out).toContain('没有启动任何东西');
    expect(out).toContain('--startGroups 每日 活动');
    expect(out).toContain('cwd:');
  });

  it('组名不存在时拦住，并把现有名字列出来', async () => {
    const out = await callTool(makeWorld(), 'bettergi_run', {
      mode: 'groups',
      groups: ['每日', '不存在的组'],
    });
    expect(out).toContain('状态: blocked');
    expect(out).toContain('不存在的组');
    expect(out).toContain('现有配置组（3）');
    for (const name of ['每日', '活动', '关机']) expect(out).toContain(name);
    expect(out).toContain('force=true');
  });

  it('force=true 时按原样发出，并留下提示', async () => {
    const out = await callTool(makeWorld(), 'bettergi_run', {
      mode: 'groups',
      groups: ['临时组'],
      force: true,
      dryRun: true,
    });
    expect(out).toContain('--startGroups 临时组');
    expect(out).toContain('force');
  });

  it('一条龙配置名对不上只提示，不拦', async () => {
    const out = await callTool(makeWorld(), 'bettergi_run', {
      mode: 'oneDragon',
      configName: '不存在的配置',
      dryRun: true,
    });
    expect(out).toContain('startOneDragon 不存在的配置');
    expect(out).toContain('会退回界面上选定的');
  });

  it('exe 不存在时不发命令', async () => {
    const ctx = fakeWorldContext(BETTERGI, { scratchDir: scratch });
    ctx.persist({ exePath: join(scratch, 'missing.exe'), userDir });
    const out = await callTool(BETTERGI.create(ctx), 'bettergi_run', { mode: 'start' });
    expect(out).toContain('状态: blocked');
    expect(out).toContain('找不到');
  });

  it('缺组名时拒绝执行', async () => {
    const out = await callTool(makeWorld(), 'bettergi_run', { mode: 'groups', groups: [] });
    expect(out).toContain('状态: blocked');
    expect(out).toContain('bettergi_list');
  });
});

describe('bettergi_stop', () => {
  it('allowStop 关掉后只报告', async () => {
    const out = await callTool(makeWorld({ allowStop: false }), 'bettergi_stop');
    expect(out).toContain('状态: blocked');
    expect(out).toContain('allowStop');
  });
});

describe('控制台输出解码', () => {
  it('UTF-8 正常解', () => {
    expect(decodeConsole(Buffer.from('拒绝访问', 'utf8'))).toBe('拒绝访问');
  });

  it('GBK 输出回退解码（中文系统上 net session 的报错就是 GBK）', () => {
    expect(decodeConsole(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))).toBe('中文');
  });

  it('空输入', () => {
    expect(decodeConsole(new Uint8Array())).toBe('');
  });
});
