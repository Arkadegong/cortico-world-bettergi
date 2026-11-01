import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 默认缓存放系统 Temp，本机上那个目录写不进去；挪到包内。
  cacheDir: '.vitest',
  test: {
    include: ['tests/**/*.test.ts'],
    env: { CORTICO_LANGUAGE: 'zh' },
    testTimeout: 20000,
    pool: 'forks',
  },
});
