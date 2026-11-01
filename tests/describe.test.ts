import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BETTERGI } from '../src/definition.ts';

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as unknown;
const readText = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('describe.json 与代码一致', () => {
  it('tools 与定义里的声明逐字段相同', () => {
    const file = readJson('../describe.json') as { tools: unknown };
    expect(file.tools).toEqual(BETTERGI.describe?.tools ?? []);
  });

  it('events 与定义里的声明逐字段相同', () => {
    const file = readJson('../describe.json') as { events: unknown };
    expect(file.events).toEqual(BETTERGI.describe?.events ?? []);
  });

  it('提示词原文就是 src/ENV_PROMPT.md 的内容', () => {
    const file = readJson('../describe.json') as {
      prompts: Array<{ key: string; role: string; content: string }>;
    };
    const doc = file.prompts.find((p) => p.role === 'envPrompt');
    expect(doc, 'describe.json 里缺 envPrompt').toBeTruthy();
    expect(doc!.key).toBe('worlds.bettergi.envPrompt');
    expect(doc!.content).toBe(readText('../src/ENV_PROMPT.md'));
  });
});
