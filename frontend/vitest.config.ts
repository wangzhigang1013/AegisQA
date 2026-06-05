import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    // Ant Design 表格、弹窗和路由懒加载测试在全量并行运行时会超过默认 10 秒；
    // 放宽到 30 秒保留断言强度，同时避免把正常的重页面渲染误判为失败。
    testTimeout: 30_000,
    // 当前前端套件包含多个完整 AppShell + Ant Design 页面渲染；Windows 上全量高并发
    // 会让懒加载等待超出单测上限，因此限制 worker 数保证 CI 和本地验证稳定。
    minWorkers: 1,
    maxWorkers: 2,
    exclude: ['node_modules/**', 'dist/**', 'e2e/**', 'playwright-report/**', 'test-results/**'],
  },
});
