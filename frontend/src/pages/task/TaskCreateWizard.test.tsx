import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskCreateWizard, type TaskCreateFormValues } from './TaskCreateWizard';
import { demoSkills } from '../../data/demo';
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
    graph: {
      name: 'RAG 回归评测',
      nodes: [
        { node_id: 'source', node_type: 'source', label: '数据源' },
        { node_id: 'answer', node_type: 'skill', label: '生成回答', skill_ref: 'llm.call@0.1.0' },
      ],
      edges: [{ source: 'source', target: 'answer' }],
    },
    steps: [
      {
        step_id: 'answer',
        skill_ref: 'llm.call@0.1.0',
        input_mapping: { prompt: 'row.question' },
        output_mapping: { answer: 'context.answer' },
        config: { model: 'workflow-default' },
        cacheable: true,
      },
    ],
  },
];

const passedPreflight = {
  status: 'passed',
  summary: '预检通过，可以创建并执行任务。',
  dataset_id: 'dataset-demo',
  dataset_version: 1,
  workflow_version_id: 'wf-demo:v1',
  execution_template_id: undefined,
  evaluation_goal: 'release_gate',
  quality_gate: { pass_rate: 0.9, max_badcase_count: 0 },
  sample_repeat_times: 1,
  cost_budget: undefined,
  checks: [],
};

const blockedPreflight = {
  status: 'blocked',
  summary: '预检阻断：字段缺失。',
  dataset_id: 'dataset-demo',
  dataset_version: 1,
  workflow_version_id: 'wf-demo:v1',
  execution_template_id: undefined,
  evaluation_goal: 'release_gate',
  quality_gate: { pass_rate: 0.9, max_badcase_count: 0 },
  sample_repeat_times: 1,
  cost_budget: undefined,
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

const executionTemplates = [
  {
    template_id: 'tasktpl-strict',
    name: '高严谨回归模板',
    description: '用于上线前高严谨回归。',
    evaluation_goal: 'regression',
    quality_gate: { pass_rate: 0.96, max_badcase_count: 1 },
    execution_config: {
      chunk_size: 50,
      concurrency: 2,
      sample_repeat_times: 3,
      retry: { max_retries: 2, backoff_seconds: 4 },
      cost_budget: 30,
    },
    tags: ['regression', 'strict'],
    source: 'custom',
    created_at: '2026-05-31T00:00:00Z',
    updated_at: '2026-05-31T00:00:00Z',
  },
];

const strictTemplatePreflight = {
  ...passedPreflight,
  execution_template_id: 'tasktpl-strict',
  evaluation_goal: 'regression',
  quality_gate: { pass_rate: 0.96, max_badcase_count: 1 },
  sample_repeat_times: 3,
  cost_budget: 30,
};

const customParamPreflight = {
  ...passedPreflight,
  sample_repeat_times: 2,
  cost_budget: 12.5,
};

const overridePreflight = {
  ...passedPreflight,
  skill_overrides: { answer: { model: 'task-model' } },
};

describe('TaskCreateWizard', () => {
  it('关闭弹窗时不会触发 useForm 未连接警告', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const { rerender } = render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={vi.fn()} />);
      rerender(<TaskCreateWizard open={false} datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={vi.fn()} />);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const errorText = consoleError.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(errorText).not.toContain('Instance created by `useForm` is not connected');
    } finally {
      consoleError.mockRestore();
    }
  });

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

  it('选择执行参数模板后会填充质量门槛和执行参数', async () => {
    const onSubmit = vi.fn();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} executionTemplates={executionTemplates} loading={false} preflightLoading={false} preflightResult={strictTemplatePreflight} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '模板任务' } });
    await chooseSelectOption('执行参数模板', '高严谨回归模板');
    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining<Partial<TaskCreateFormValues>>({
        execution_template_id: 'tasktpl-strict',
        evaluation_goal: 'regression',
        pass_rate_threshold: 0.96,
        max_badcase_count: 1,
        chunk_size: 50,
        concurrency: 2,
        sample_repeat_times: 3,
        max_retries: 2,
        retry_backoff_seconds: 4,
        cost_budget: 30,
      }),
    );
  });

  it('Preflight 后修改关键参数会要求重新运行预检', async () => {
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} preflightResult={passedPreflight} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={vi.fn()} />);

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    expect(screen.getByRole('button', { name: '确认创建任务' })).not.toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('例如：20.00'), { target: { value: '12.5' } });

    expect(screen.getByRole('button', { name: '确认创建任务' })).toBeDisabled();
    expect(screen.getByText('Preflight 结果已过期')).toBeInTheDocument();
  });

  it('运行 Preflight 会提交完整默认执行参数', async () => {
    const onPreflight = vi.fn();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={onPreflight} onSubmit={vi.fn()} />);

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));

    expect(onPreflight).toHaveBeenCalledWith(
      expect.objectContaining<Partial<TaskCreateFormValues>>({
        evaluation_goal: 'release_gate',
        pass_rate_threshold: 0.9,
        max_badcase_count: 0,
        sample_repeat_times: 1,
        max_retries: 1,
        retry_backoff_seconds: 0,
      }),
    );
  });

  it('任务级 Skill 参数覆盖会进入 Preflight 和创建请求', async () => {
    const onPreflight = vi.fn();
    const onSubmit = vi.fn();
    const { unmount } = render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={onPreflight} onSubmit={onSubmit} />);

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    fireEvent.click(screen.getByRole('button', { name: '添加任务级参数覆盖' }));
    await chooseSelectOption('覆盖 Step', '生成回答 / answer');
    fireEvent.change(screen.getByPlaceholderText('例如：model'), { target: { value: 'model' } });
    fireEvent.change(screen.getByPlaceholderText('覆盖值'), { target: { value: 'task-model' } });
    fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));

    expect(onPreflight).toHaveBeenCalledWith(
      expect.objectContaining<Partial<TaskCreateFormValues>>({
        skill_overrides: { answer: { model: 'task-model' } },
      }),
    );

    unmount();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} preflightResult={overridePreflight} onCancel={vi.fn()} onPreflight={onPreflight} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '覆盖参数任务' } });
    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    fireEvent.click(screen.getByRole('button', { name: '添加任务级参数覆盖' }));
    await chooseSelectOption('覆盖 Step', '生成回答 / answer');
    fireEvent.change(screen.getByPlaceholderText('例如：model'), { target: { value: 'model' } });
    fireEvent.change(screen.getByPlaceholderText('覆盖值'), { target: { value: 'task-model' } });
    fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining<Partial<TaskCreateFormValues>>({
        skill_overrides: { answer: { model: 'task-model' } },
      }),
    );
  });

  it('任务级 Skill 参数覆盖按所选 Step 的 config_schema 选择参数并推断值类型', async () => {
    const onPreflight = vi.fn();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} skills={demoSkills} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={onPreflight} onSubmit={vi.fn()} />);

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    fireEvent.click(screen.getByRole('button', { name: '添加任务级参数覆盖' }));
    await chooseSelectOption('覆盖 Step', '生成回答 / answer');
    await chooseSelectOption('参数名', 'temperature / number');
    fireEvent.change(screen.getByLabelText('覆盖值'), { target: { value: '0.35' } });
    fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));

    expect(onPreflight).toHaveBeenCalledWith(
      expect.objectContaining<Partial<TaskCreateFormValues>>({
        skill_overrides: { answer: { temperature: 0.35 } },
      }),
    );
  });

  it('任务级表达式参数覆盖可从 Dataset field_paths 选择路径', async () => {
    const onPreflight = vi.fn();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} skills={demoSkills} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={onPreflight} onSubmit={vi.fn()} />);

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    fireEvent.click(screen.getByRole('button', { name: '添加任务级参数覆盖' }));
    await chooseSelectOption('覆盖 Step', '生成回答 / answer');
    await chooseSelectOption('参数名', 'model / string');
    await chooseSelectOption('覆盖值类型', '表达式路径');
    await chooseSelectOption('表达式路径', 'row.question');
    fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));

    expect(onPreflight).toHaveBeenCalledWith(
      expect.objectContaining<Partial<TaskCreateFormValues>>({
        skill_overrides: { answer: { model: { type: 'expression', path: 'row.question' } } },
      }),
    );
  });

  it('Preflight 后修改任务级 Skill 参数覆盖会要求重新运行预检', async () => {
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} preflightResult={overridePreflight} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={vi.fn()} />);

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1');
    fireEvent.click(screen.getByRole('button', { name: '添加任务级参数覆盖' }));
    await chooseSelectOption('覆盖 Step', '生成回答 / answer');
    fireEvent.change(screen.getByPlaceholderText('例如：model'), { target: { value: 'model' } });
    fireEvent.change(screen.getByPlaceholderText('覆盖值'), { target: { value: 'task-model' } });
    expect(screen.getByRole('button', { name: '确认创建任务' })).not.toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('覆盖值'), { target: { value: 'changed-model' } });

    expect(screen.getByRole('button', { name: '确认创建任务' })).toBeDisabled();
    expect(screen.getByText('Preflight 结果已过期')).toBeInTheDocument();
  });

  it('提交任务参数时包含并发、重试、repeat 和成本预算', async () => {
    const onSubmit = vi.fn();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} preflightResult={customParamPreflight} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={onSubmit} />);

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
  const candidates = await screen.findAllByText(optionText);
  fireEvent.click(candidates[candidates.length - 1]);
}
