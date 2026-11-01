import type { ConfigGroup } from 'cortico/core/types.ts';

/** config.json 的 `worlds.bettergi` 段。默认禁用，装上不会自己生效。 */
export interface BetterGiConfigSection {
  enabled: boolean;
  /** `BetterGI.exe` 的绝对路径。 */
  exePath: string;
  /** 用户数据目录（含 ScriptGroup / OneDragon）；空串 = `<exe 所在目录>\User`。 */
  userDir: string;
  /** 启动后等进程出现的最长时间（毫秒）。 */
  launchTimeoutMs: number;
  /** 是否允许 `bettergi_stop` 结束进程。 */
  allowStop: boolean;
  /** 结束进程时先请它自己关；等这么久还在就强杀（毫秒）。 */
  stopGraceMs: number;
}

export const BETTERGI_DEFAULTS: BetterGiConfigSection = {
  enabled: false,
  exePath: 'C:\\Program Files\\BetterGI\\BetterGI.exe',
  userDir: '',
  launchTimeoutMs: 20_000,
  allowStop: true,
  stopGraceMs: 5_000,
};

/** World 配置的 JSON Schema 声明；路径一律落在 `worlds.bettergi.` 段内。 */
export const BETTERGI_CONFIG_GROUP: ConfigGroup = {
  id: 'world:bettergi',
  owner: 'world:bettergi',
  schema: {
    type: 'object',
    title: 'BetterGI',
    description: 'BetterGI（更好的原神）的命令行驱动：启动、按配置组跑调度器、跑一条龙、查状态。',
    properties: {
      'worlds.bettergi.exePath': {
        type: 'string',
        title: 'BetterGI.exe 路径',
        'x-hot': false,
        description: 'BetterGI 主程序的绝对路径。',
      },
      'worlds.bettergi.userDir': {
        type: 'string',
        title: '用户数据目录',
        'x-hot': true,
        description: '留空表示 <exe 所在目录>\\User；配置组与一条龙配置都在它下面。',
      },
      'worlds.bettergi.launchTimeoutMs': {
        type: 'integer',
        title: '启动等待',
        minimum: 1000,
        maximum: 120_000,
        multipleOf: 1000,
        'x-scale': 1000,
        'x-suffix': 's',
        'x-hot': true,
        description: '启动后等进程出现多久算超时。',
      },
      'worlds.bettergi.allowStop': {
        type: 'boolean',
        title: '允许结束进程',
        'x-hot': true,
        description: '关掉后 bettergi_stop 只报告状态，不动进程。',
      },
      'worlds.bettergi.stopGraceMs': {
        type: 'integer',
        title: '优雅关闭等待',
        minimum: 0,
        maximum: 60_000,
        multipleOf: 1000,
        'x-scale': 1000,
        'x-suffix': 's',
        'x-hot': false,
        description: '先请它自己关，等不到再强杀。',
      },
    },
  },
};
