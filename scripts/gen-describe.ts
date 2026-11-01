/**
 * 生成 describe.json：把定义里的 tools / events 和环境提示词模板原文落成文件。
 * 官方索引与扩展市场只读这个文件、不执行包代码，所以它必须与代码一致。
 * 用法：pnpm exec tsx scripts/gen-describe.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { BETTERGI } from '../src/definition.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const world = BETTERGI.create(fakeWorldContext(BETTERGI, { scratchDir: join(tmpdir(), 'bettergi-describe') }));

const prompts = (world.webUi().promptDocs ?? [])
  .filter((doc) => doc.role === 'envPrompt')
  .map((doc) => ({
    key: doc.key,
    title: doc.title,
    role: doc.role,
    content: readFileSync(doc.path, 'utf8'),
  }));

const out = {
  tools: BETTERGI.describe?.tools ?? [],
  events: BETTERGI.describe?.events ?? [],
  prompts,
};

writeFileSync(join(root, 'describe.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`describe.json 已更新：${out.tools.length} 个工具，${out.events.length} 个事件，${prompts.length} 段提示词`);
