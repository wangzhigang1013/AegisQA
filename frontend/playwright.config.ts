import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const apiPort = process.env.E2E_API_PORT ?? '8010';
const apiTarget = `http://127.0.0.1:${apiPort}`;
const webPort = process.env.E2E_WEB_PORT ?? '5174';
const webTarget = `http://127.0.0.1:${webPort}`;
const runId = process.env.E2E_RUN_ID ?? `${Date.now()}-${process.pid}`;
const artifactRoot = path.resolve('..', '.e2e-artifacts', runId);
const storeRoot = path.join(artifactRoot, 'store');
const apiLogPath = path.join(artifactRoot, 'api.log');
const webLogPath = path.join(artifactRoot, 'web.log');

mkdirSync(storeRoot, { recursive: true });

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: {
    timeout: 12_000,
  },
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: path.join(artifactRoot, 'playwright-report'), open: 'never' }]],
  outputDir: path.join(artifactRoot, 'test-results'),
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
      command: `python -m uvicorn aegisqa.api.app:create_app --factory --host 127.0.0.1 --port ${apiPort} > "${apiLogPath}" 2>&1`,
      cwd: '..',
      env: {
        ...process.env,
        AEGISQA_STORE_ROOT: storeRoot,
        AEGISQA_STORAGE_BACKEND: process.env.E2E_STORAGE_BACKEND ?? 'json',
        AEGISQA_TASK_EXECUTOR: process.env.E2E_TASK_EXECUTOR ?? 'local',
      },
      url: `${apiTarget}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // 前端通过 Vite 代理访问 /api，保持和本地开发一致的路径。
      command: `npm run dev -- --host 127.0.0.1 --port ${webPort} > "${webLogPath}" 2>&1`,
      env: {
        ...process.env,
        VITE_API_TARGET: apiTarget,
        VITE_ENABLE_CI_GATE: 'true',
        VITE_ENABLE_CANDIDATE_ASSETS: 'true',
        VITE_ENABLE_REPAIR_TASKS: 'true',
        VITE_ENABLE_EXPERIMENTS: 'true',
        VITE_ENABLE_ANNOTATION_QUEUE: 'true',
        VITE_ENABLE_JUDGE_AUDIT: 'true',
      },
      url: webTarget,
      reuseExistingServer: false,
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
