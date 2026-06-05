import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { demoDataset, installDefaultWorkbenchMocks, jsonResponse, renderWorkbench } from './workbenchTestHarness';

describe('DatasetsPage 字段治理', () => {
  installDefaultWorkbenchMocks();

  it('接口没有 Dataset 时不展示 demo 字段预览兜底', async () => {
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/datasets')) return jsonResponse([]);
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/datasets');

    expect(await screen.findByText('字段预览与类型修正')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('row.question')).not.toBeInTheDocument());
    expect(screen.getByText(/暂无 Dataset Version/)).toBeInTheDocument();
  });

  it('展示字段治理诊断并基于诊断生成修复版 Dataset Version', async () => {
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const requests: { url: string; method?: string; body?: string }[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method, body: String(init?.body ?? '') });
      if (url.endsWith('/datasets/dataset-demo/versions/1/quality')) {
        return jsonResponse({
          dataset_id: 'dataset-demo',
          dataset_version: 1,
          dataset_version_id: 'dataset-demo:v1',
          name: '问答回归集',
          summary: {
            row_count: 100,
            field_count: 3,
            fields_with_missing: 1,
            duplicate_row_count: 4,
            duplicate_group_count: 2,
            duplicate_rate: 0.04,
          },
          fields: [
            {
              field: 'reference',
              path: 'row.reference',
              type: 'string',
              present_count: 67,
              missing_count: 33,
              coverage_rate: 0.67,
              missing_rate: 0.33,
              distinct_count: 60,
              recommendation: { action: 'fill_missing', message: '建议补齐 reference 后再发布 Workflow。' },
            },
          ],
          duplicate_groups: [{ row_hash: 'hash-demo', row_ids: ['2', '3'], count: 2, sample: { question: '重复问题' } }],
        });
      }
      if (url.endsWith('/datasets/dataset-demo/versions/1/repair-version') && init?.method === 'POST') {
        return jsonResponse({
          ...demoDataset.versions[0],
          version: 2,
          version_id: 'dataset-demo:v2',
          row_count: 96,
          preview: [{ question: '什么是 AegisQA?', reference: 'AI 评测平台', expected_label: 'pass' }],
        });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/datasets?dataset_id=dataset-demo&version=1');

    expect(await screen.findByText('字段治理诊断')).toBeInTheDocument();
    expect(await screen.findByText('覆盖率 67.0%')).toBeInTheDocument();
    expect(screen.getByText('重复样本 4 条')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /生成修复版 Dataset Version/ }));

    await waitFor(() => {
      const repairRequest = requests.find((request) => request.url.endsWith('/datasets/dataset-demo/versions/1/repair-version'));
      expect(repairRequest).toBeTruthy();
      const body = JSON.parse(repairRequest?.body ?? '{}');
      expect(body.drop_duplicate_rows).toBe(true);
      expect(body.fill_missing).toEqual({ reference: '待补充' });
    });
    expect(await screen.findByText(/已生成修复版 Dataset Version：dataset-demo:v2/)).toBeInTheDocument();
  });
});
