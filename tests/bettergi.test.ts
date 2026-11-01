import { describe, it, expect } from 'vitest';
import {
  buildElevateCommand,
  buildRunArgs,
  matchNames,
  parseTasklist,
  protocolUrl,
  quoteArg,
  renderCommand,
} from '../src/bettergi.ts';

describe('拼参数', () => {
  it('start 只有一个 token', () => {
    expect(buildRunArgs({ mode: 'start' }).args).toEqual(['start']);
  });

  it('一条龙不填配置名就是页面选定的那个', () => {
    expect(buildRunArgs({ mode: 'oneDragon' }).args).toEqual(['startOneDragon']);
    expect(buildRunArgs({ mode: 'oneDragon', configName: '   ' }).args).toEqual(['startOneDragon']);
  });

  it('一条龙带配置名', () => {
    expect(buildRunArgs({ mode: 'oneDragon', configName: '默认配置' }).args).toEqual([
      'startOneDragon',
      '默认配置',
    ]);
  });

  it('调度器按顺序塞组名，空名被丢掉', () => {
    expect(buildRunArgs({ mode: 'groups', groups: ['每日', ' ', '活动'] }).args).toEqual([
      '--startGroups',
      '每日',
      '活动',
    ]);
  });

  it('组名一个都没有时拒绝，并说清怎么查', () => {
    const r = buildRunArgs({ mode: 'groups', groups: [] });
    expect(r.args).toEqual([]);
    expect(r.problem).toContain('bettergi_list');
  });

  it('以 - 开头的名字会被当成参数，直接拒绝', () => {
    expect(buildRunArgs({ mode: 'groups', groups: ['--help'] }).problem).toContain('不能以 - 开头');
    expect(buildRunArgs({ mode: 'oneDragon', configName: '--x' }).problem).toContain('不能以 - 开头');
  });

  it('未知 mode 拒绝', () => {
    expect(buildRunArgs({ mode: 'nope' as never }).problem).toContain('未知的 mode');
  });
});

describe('URL 协议覆盖范围', () => {
  it('start 与不带配置名的一条龙才有协议版本', () => {
    expect(protocolUrl({ mode: 'start' })).toBe('bettergi://start');
    expect(protocolUrl({ mode: 'oneDragon' })).toBe('bettergi://startOneDragon');
    expect(protocolUrl({ mode: 'oneDragon', configName: '默认配置' })).toBeNull();
    expect(protocolUrl({ mode: 'groups', groups: ['每日'] })).toBeNull();
  });
});

describe('解 tasklist', () => {
  it('正常的 CSV 行', () => {
    const text = '"BetterGI.exe","1234","Console","1","123,456 K"\r\n"YuanShen.exe","5678","Console","1","2,000 K"';
    expect(parseTasklist(text)).toEqual([
      { name: 'BetterGI.exe', pid: 1234 },
      { name: 'YuanShen.exe', pid: 5678 },
    ]);
  });

  it('没有匹配时 tasklist 打的是提示句，当成空表', () => {
    expect(parseTasklist('信息: 没有运行的任务匹配指定标准。')).toEqual([]);
    expect(parseTasklist('INFO: No tasks are running which match the specified criteria.')).toEqual([]);
  });

  it('空输入返回空表', () => {
    expect(parseTasklist('')).toEqual([]);
  });
});

describe('名字比对', () => {
  const available = ['每日', '活动', 'Daily-Route'];

  it('精确与忽略大小写都能认', () => {
    expect(matchNames(['每日', 'daily-route'], available)).toEqual({
      known: ['每日', 'Daily-Route'],
      unknown: [],
    });
  });

  it('对不上的单独列出来', () => {
    expect(matchNames(['每日', '不存在的组'], available)).toEqual({
      known: ['每日'],
      unknown: ['不存在的组'],
    });
  });
});

describe('命令渲染', () => {
  it('带空格的整段加引号，普通参数原样', () => {
    expect(quoteArg('每日')).toBe('每日');
    expect(quoteArg('Program Files')).toBe('"Program Files"');
    expect(renderCommand('C:\\a b\\BetterGI.exe', ['--startGroups', '每日'])).toBe(
      '"C:\\a b\\BetterGI.exe" --startGroups 每日',
    );
  });

  it('提权命令把参数拼成数组，单引号按 PowerShell 规则翻倍', () => {
    const script = buildElevateCommand("C:\\Program Files\\BetterGI\\BetterGI.exe", ['--startGroups', "a'b"], 'C:\\x');
    expect(script).toContain('-Verb RunAs');
    expect(script).toContain("-ArgumentList @('--startGroups', 'a''b')");
    expect(script).toContain("-WorkingDirectory 'C:\\x'");
  });

  it('没有参数时给空数组而不是空串', () => {
    expect(buildElevateCommand('C:\\b.exe', [], 'C:\\x')).toContain('-ArgumentList @()');
  });
});
