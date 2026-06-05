import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    // Ant Design 表格、弹窗和路由懒加载测试在全量并行运行时会超过默认 10 秒；
    // 放宽到 30 秒保留断言强度，同时避免把正常的重页面渲染误判为失败。
    testTimeout: 30_000,
    exclude: ['node_modules/**', 'dist/**', 'e2e/**', 'playwright-report/**', 'test-results/**'],
  },
});
