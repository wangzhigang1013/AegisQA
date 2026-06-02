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
        field_paths: ['row.question', 'row.reference'],
        preview: [],
        golden: true,
      },
    ],
  },
];

const apCodeDatasets: DatasetSummary[] = [
  {
    dataset_id: 'dataset-ap',
    name: '审批码数据集',
    latest_version: 1,
    latest_version_id: 'dataset-ap:v1',
    row_count: 50,
    golden: false,
    versions: [
      {
        dataset_id: 'dataset-ap',
        name: '审批码数据集',
        version: 1,
        version_id: 'dataset-ap:v1',
        row_count: 50,
        field_schema: { ap_code: 'string', user_name: 'string' },
        field_paths: ['row.ap_code', 'row.user_name'],
        preview: [],
        golden: false,
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
        { node_id: 'answer', node_type: 'skill', label: '生成回答', skill_ref: 'llm.call@0.1.0', input_mapping: { prompt: 'row.question' } },
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

const apCodeWorkflow: WorkflowVersion = {
  workflow_id: 'wf-ap',
  name: '审批码抽样流程',
  version: 3,
  version_id: 'wf-ap:v3',
  status: 'published',
  graph: {
    name: '审批码抽样流程',
    nodes: [
      { node_id: 'source', node_type: 'source', label: '数据源' },
      { node_id: 'extract', node_type: 'skill', label: '抽样审批码', skill_ref: 'ap.extract@0.1.0', input_mapping: { text: 'row.ap_code' } },
    ],
    edges: [{ source: 'source', target: 'extract' }],
  },
  steps: [
    {
      step_id: 'extract',
      skill_ref: 'ap.extract@0.1.0',
      input_mapping: { text: 'row.ap_code' },
      output_mapping: { result: 'context.result' },
      config: {},
      cacheable: true,
    },
  ],
};

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

  it('创建任务只保留最小必要字段，不展示执行模板、质量门槛和任务级覆盖', async () => {
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByText('创建任务')).toBeInTheDocument();
    expect(screen.queryByText('执行参数模板')).not.toBeInTheDocument();
    expect(screen.queryByText('质量门槛')).not.toBeInTheDocument();
    expect(screen.queryByText('任务级 Skill 参数覆盖')).not.toBeInTheDocument();
    expect(screen.queryByText('评测目的')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /运行 Preflight/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '确认创建任务' })).toBeDisabled();
  });

  it('必须选择 Dataset、Workflow 并完成可继续的 Preflight 后才能创建', async () => {
    const onSubmit = vi.fn();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={onSubmit} />);

    const createButton = screen.getByRole('button', { name: '确认创建任务' });
    expect(createButton).toBeDisabled();

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    expect(createButton).toBeDisabled();

    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1 / 需要 row.question');
    expect(createButton).toBeDisabled();
  });

  it('运行 Preflight 只提交任务名、Dataset Version 和 Workflow Version', async () => {
    const onPreflight = vi.fn();
    render(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={onPreflight} onSubmit={vi.fn()} />);

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1 / 需要 row.question');
    fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));

    await waitFor(() => expect(onPreflight).toHaveBeenCalledWith(
      expect.objectContaining<Partial<TaskCreateFormValues>>({
        dataset_version_id: 'dataset-demo:v1',
        workflow_version_id: 'wf-demo:v1',
      }),
    ));
    expect(onPreflight.mock.calls[0][0]).not.toHaveProperty('execution_template_id');
    expect(onPreflight.mock.calls[0][0]).not.toHaveProperty('quality_gate');
    expect(onPreflight.mock.calls[0][0]).not.toHaveProperty('sample_repeat_times');
    expect(onPreflight.mock.calls[0][0]).not.toHaveProperty('skill_overrides');
  });

  it('Workflow 需要的数据字段会直接展示，数据集不匹配时提示用户选择正确版本或重新发布', async () => {
    render(<TaskCreateWizard open datasets={apCodeDatasets} workflows={workflows} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={vi.fn()} />);

    await chooseSelectOption('Dataset Version', '审批码数据集 v1 / 50 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1 / 需要 row.question');

    expect(screen.getByText('Dataset 与 Workflow 字段不匹配')).toBeInTheDocument();
    expect(screen.getByText(/当前 Workflow 版本读取 row.question/)).toBeInTheDocument();
    expect(screen.getByText(/如果你没有使用这些字段，请回 Workflow 画布确认输入绑定并重新发布/)).toBeInTheDocument();
  });

  it('Workflow 列表按版本倒序展示，避免误选旧版本字段映射', async () => {
    render(<TaskCreateWizard open datasets={apCodeDatasets} workflows={[workflows[0], apCodeWorkflow]} loading={false} preflightLoading={false} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={vi.fn()} />);

    fireEvent.mouseDown(getSelectInput('Workflow Version'));
    const apWorkflow = await screen.findByText('审批码抽样流程 v3 / 需要 row.ap_code');
    const oldWorkflow = await screen.findByText('RAG 回归评测 v1 / 需要 row.question');

    expect(apWorkflow.compareDocumentPosition(oldWorkflow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1 / 需要 row.question');

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
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1 / 需要 row.question');
    fireEvent.click(screen.getByLabelText('我已确认 Preflight 阻断风险，仍要创建任务'));

    rerender(<TaskCreateWizard open datasets={datasets} workflows={workflows} loading={false} preflightLoading={false} preflightResult={passedPreflight} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ allow_blocked_preflight: false }));
  });

  it('Preflight 后修改 Dataset 或 Workflow 会要求重新运行预检', async () => {
    render(<TaskCreateWizard open datasets={datasets} workflows={[workflows[0], apCodeWorkflow]} loading={false} preflightLoading={false} preflightResult={passedPreflight} onCancel={vi.fn()} onPreflight={vi.fn()} onSubmit={vi.fn()} />);

    await chooseSelectOption('Dataset Version', '问答回归集 v1 / 100 条');
    await chooseSelectOption('Workflow Version', 'RAG 回归评测 v1 / 需要 row.question');
    expect(screen.getByRole('button', { name: '确认创建任务' })).not.toBeDisabled();

    await chooseSelectOption('Workflow Version', '审批码抽样流程 v3 / 需要 row.ap_code');

    expect(screen.getByRole('button', { name: '确认创建任务' })).toBeDisabled();
    expect(screen.getByText('Preflight 结果已过期')).toBeInTheDocument();
  });
});

async function chooseSelectOption(label: string, optionText: string) {
  const selectInput = getSelectInput(label);
  fireEvent.mouseDown(selectInput);
  const candidates = await screen.findAllByText(optionText);
  fireEvent.click(candidates[candidates.length - 1]);
}

function getSelectInput(label: string) {
  const selectInput = screen.getAllByLabelText(label).find((element) => element.getAttribute('role') === 'combobox');
  if (!selectInput) {
    throw new Error(`找不到下拉输入框：${label}`);
  }
  return selectInput;
}
