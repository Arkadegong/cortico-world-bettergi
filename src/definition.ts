import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { BETTERGI_DEFAULTS, type BetterGiConfigSection } from './config.ts';
import { BETTERGI_TOOL_DECLS, BetterGiWorld } from './world.ts';

/** World 定义：id 与 package.json 的包名后缀一致，配置段是 `worlds.bettergi`。 */
export const BETTERGI: WorldDefinition<BetterGiConfigSection> = {
  id: 'bettergi',
  label: 'BetterGI',
  defaults: () => ({ ...BETTERGI_DEFAULTS }),
  create: (ctx) => new BetterGiWorld({ cfg: ctx.cfg, timezone: ctx.timezone }),
  describe: {
    tools: describeTools(BETTERGI_TOOL_DECLS, {
      bettergi_status: {
        zh: '报 BetterGI 是否在跑、当前进程有没有提权、程序与用户目录在哪、配置组几个、游戏在不在。',
        en: 'Reports whether BetterGI and the game are running, elevation state, paths and config counts.',
      },
      bettergi_list: {
        zh: '列出调度器配置组名与一条龙配置名，供启动命令直接引用。',
        en: 'Lists scheduler config group names and one-dragon config names.',
      },
      bettergi_run: {
        zh: '启动 BetterGI 或把指令交给它：start / oneDragon / groups（按序跑配置组）。',
        en: 'Launches BetterGI or hands it a command: start, oneDragon, or groups.',
      },
      bettergi_stop: {
        zh: '先礼后兵地结束 BetterGI：优雅关闭，超时才强杀。',
        en: 'Closes BetterGI gracefully and force-kills it only after the grace period.',
      },
    }),
    events: [],
  },
};
