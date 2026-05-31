import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskCreateWizard, type TaskCreateFormValues } from './TaskCreateWizard';
import type { DatasetSummary, WorkflowVersion } from '../../types';

const datasets: DatasetSummary[] = [
  {
    dataset_id: 'dataset-demo',
    name: '问答回归集',
    latest_version: 1,
    latest_version_id: 'dataset-demo:v1',
    row_count: 100,
    golden: true,
    versions: [
      {
        dataset_id: 'dataset-demo',
        name: '问答回归集',
        version: 1,
        version_id: 'dataset-demo:v1',
        row_count: 100,
        field_schema: { question: 'string', reference: 'string' },
        preview: [],
        golden: true,
      },
    ],
  },
];

const workflows: WorkflowVersion[] = [
  {
    workflow_id: 'wf-demo',
    name: 'RAG 回归评测',
    version: 1,
    version_id: 'wf-demo:v1',
    status: 'published',
    steps: [],
  },
];

const passedPreflight = {
  status: 'passed',
  summary: '预检通过，可以创建并执行任务。',
  dataset_id: 'dataset-demo',
  dataset_version: 1,
  workflow_version_id: 'wf-demo:v1',
  checks: [],
};

const blockedPreflight = {
  status: 'blocked',
  summary: '预检阻断：字段缺失。',
  dataset_id: 'dataset-demo',
  dataset_version: 1,
  workflow_version_id: 'wf-demo:v1',
  checks: [
    {
      check_id: 'field_mapping',
      title: 'Workflow 字段映射',
      status: 'blocked',
      message: '数据集缺少字段：reference。',
      details: {},
      recommendation: '请修正字段映射。',
    },
  ],
};

describe('TaskCreateWizard', () => {
  it('必须选择 Dataset、Workflow 并完成可继续的 Preflight 后才能创建', async () => {
    const onSubmit = vi.fn();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={onSubmit} />);

    const createButton = screen.getByRole('button', { name: '确认创建任务' });
    expect(createButton).toBeDisabled();

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    expect(createButton).toBeDisabled();

    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    expect(createButton).toBeDisabled();
  });

  it('Preflight 阻断时默认不能创建，必须显式确认风险', async () => {
    const onSubmit = vi.fn();
    render(
      <TaskCreateWizard
        open
        datasets={datasets}
        workflows={workflows}
        loading={false}
        preflightLoading={false}
        preflightResult={blockedPreflight}
        onCancel={vi.fn()}
        onPreflight={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '强制任务' } });
    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');

    const createButton = screen.getByRole('button', { name: '确认创建任务' });
    expect(createButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText('我已确认 Preflight 阻断风险，仍要创建任务'));
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ allow_blocked_preflight: true }));
  });

  it('重新得到可继续 Preflight 后会清除强制创建标记', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} preflightResult={blockedPreflight} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '重跑 Preflight 任务' } });
    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    fireEvent.click(screen.getByLabelText('我已确认 Preflight 阻断风险，仍要创建任务'));

    rerender(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} preflightResult={passedPreflight} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ allow_blocked_preflight: false }));
  });

  it('提交任务参数时包含并发、重试、repeat 和成本预算', async () => {
    const onSubmit = vi.fn();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} preflightResult={passedPreflight} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '严谨化任务' } });
    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    fireEvent.change(screen.getByPlaceholderText('100'), { target: { value: '50' } });
    fireEvent.change(screen.getByPlaceholderText('1'), { target: { value: '3' } });
    fireEvent.change(screen.getByPlaceholderText('repeat=1'), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('max=1'), { target: { value: '4' } });
    fireEvent.change(screen.getByPlaceholderText('seconds=0'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('例如：20.00'), { target: { value: '12.5' } });

    fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining<TaskCreateFormValues>({
        name: '严谨化任务',
        dataset_version_id: 'dataset-demo:v1',
        workflow_version_id: 'wf-demo:v1',
        chunk_size: 50,
        concurrency: 3,
        sample_repeat_times: 2,
        max_retries: 4,
        retry_backoff_seconds: 5,
        cost_budget: 12.5,
      }),
    );
  });
});

async function chooseSelectOption(label: string, optionText: string) {
  const selectInput = screen.getAllByLabelText(label).find((element) => element.getAttribute('role') === 'combobox');
  if (!selectInput) {
    throw new Error(`找不到下拉输入框：${label}`);
  }
  fireEvent.mouseDown(selectInput);
  fireEvent.click(await screen.findByText(optionText));
}
