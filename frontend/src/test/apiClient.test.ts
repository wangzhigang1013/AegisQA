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
});
