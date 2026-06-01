import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env.E2E_API_PORT ?? '8010';
const apiTarget = `http://127.0.0.1:${apiPort}`;
const webPort = process.env.E2E_WEB_PORT ?? '5174';
const webTarget = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: {
    timeout: 12_000,
  },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: webTarget,
    channel: 'chrome',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      // E2E 必须打真实 FastAPI，而不是 mock；默认使用独立端口，避免复用开发中的旧 8000 服务。
      command: `python -m uvicorn aegisqa.api.app:create_app --factory --host 127.0.0.1 --port ${apiPort}`,
      cwd: '..',
      url: `${apiTarget}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // 前端通过 Vite 代理访问 /api，保持和本地开发一致的路径。
      command: `npm run dev -- --host 127.0.0.1 --port ${webPort}`,
      env: { ...process.env, VITE_API_TARGET: apiTarget },
      url: webTarget,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
