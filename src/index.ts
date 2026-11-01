/** 包入口：默认导出 `WorldDefinition`，加载器按 `cortico.kind === 'world'` 认它。 */
import { BETTERGI } from './definition.ts';

export default BETTERGI;
export { BETTERGI };
export type { BetterGiConfigSection } from './config.ts';
export { BETTERGI_DEFAULTS } from './config.ts';
