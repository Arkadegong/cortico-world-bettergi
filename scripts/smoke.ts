/**
 * 手工冒烟：对着本机真实的 BetterGI 目录跑 status / list / 演算，不启动任何东西。
 * 用法：pnpm exec tsx scripts/smoke.ts
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, ToolOutcome, World } from 'cortico/core/types.ts';
import { fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { BETTERGI } from '../src/definition.ts';

const EXE = 'C:\\Program Files\\BetterGI\\BetterGI.exe';

const ctx = fakeWorldContext(BETTERGI, { scratchDir: join(tmpdir(), 'bettergi-smoke') });
ctx.persist({ exePath: EXE });
const world = BETTERGI.create(ctx);

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = world.tools().find((t) => t.name === name)!;
  const out = (await tool.handler!(args, {} as ToolCallContext)) as string | ToolOutcome;
  return typeof out === 'string' ? out : out.text;
}

function show(title: string, text: string): void {
  console.log(`\n${'='.repeat(76)}\n### ${title}\n${'='.repeat(76)}\n${text}`);
}

show('状态', await call('bettergi_status'));
show('配置清单', await call('bettergi_list'));

const list = await call('bettergi_list');
const groups = /调度器配置组（\d+）: (.+)/.exec(list)?.[1]?.split('、').slice(0, 2) ?? ['每日'];
show('演算：按真实配置组跑', await call('bettergi_run', { mode: 'groups', groups, dryRun: true }));
show('演算：名字拼错', await call('bettergi_run', { mode: 'groups', groups: ['不存在的组'], dryRun: true }));
show('演算：一条龙（页面选定的）', await call('bettergi_run', { mode: 'oneDragon', dryRun: true }));
