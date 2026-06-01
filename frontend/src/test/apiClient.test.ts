import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from '../api/client';

describe('API client 错误处理', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('保留后端结构化错误码、详情和 trace_id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          code: 'DATASET_EMPTY',
          message: '数据集没有可执行样本',
          details: { filename: 'empty.jsonl' },
          trace_id: 'trace_test',
        }),
    } as Response);

    await expect(api.datasets()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'DATASET_EMPTY',
      message: '数据集没有可执行样本',
      details: { filename: 'empty.jsonl' },
      traceId: 'trace_test',
    });
    await expect(api.datasets()).rejects.toBeInstanceOf(ApiError);
  });

  it('Vite 代理 500 且没有结构化响应时提示后端服务可能未启动', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    } as Response);

    await expect(api.datasets()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'BACKEND_UNAVAILABLE',
      message: '后端服务不可用，请确认 FastAPI 已启动在 http://127.0.0.1:8000。',
      details: { api_base: '/api', status: 500 },
    });
  });
});
