import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '../App';
import { demoSkills, demoWorkflowGraph } from '../data/demo';

const demoWorkflowVersion = {
  workflow_id: 'wf-demo',
  name: 'RAG 回归评测',
  version: 1,
  version_id: 'wf-demo:v1',
  status: 'published',
  graph: demoWorkflowGraph,
  steps: [],
};

const demoTask = {
  task_id: 'task-demo',
  name: 'RAG 任务',
  dataset_id: 'dataset-demo',
  dataset_name: '问答回归集',
  dataset_version: 1,
  dataset_version_id: 'dataset-demo:v1',
  workflow_id: 'wf-demo',
  workflow_name: 'RAG 回归评测',
  workflow_version_id: 'wf-demo:v1',
  run_id: 'run-demo',
  status: 'queued',
  total_items: 100,
  completed_items: 0,
  failed_items: 0,
  pass_rate: 0,
  badcase_count: 0,
  execution_config: {
    concurrency: 2,
    sample_repeat_times: 1,
    retry: { max_retries: 1, backoff_seconds: 0 },
    cost_budget: 20,
  },
  current_attempt: 1,
  attempts: [
    {
      attempt_index: 1,
      run_id: 'run-demo',
      status: 'queued',
      total_items: 100,
      completed_items: 0,
      failed_items: 0,
      pass_rate: 0,
      badcase_count: 0,
      created_at: '2026-05-31T00:00:00Z',
    },
  ],
  created_at: '2026-05-31T00:00:00Z',
  updated_at: '2026-05-31T00:00:00Z',
};

const demoBadcase = {
  badcase_id: 'badcase-demo',
  run_id: 'run-demo',
  item_id: 'item-demo',
  status: 'pending_review',
  reason: 'judge_label=fail',
  payload: { question: '坏例样本', score: 0.2 },
  golden_candidate: false,
  created_at: '2026-05-31T00:00:00Z',
  updated_at: '2026-05-31T00:00:00Z',
};

async function renderWorkbench(path: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppShell />
      </MemoryRouter>,
    );
  });
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response);
}

function errorResponse(status: number, payload: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(payload),
  } as Response);
}

describe('AegisQA 前端工作台', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse(demoSkills);
      }
      if (url.endsWith('/skills/packages')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/skills/packages/upload')) {
        return jsonResponse({ package_id: 'pkg-demo', status: 'pending_review', manifest: { ...demoSkills[0], skill_id: 'plugin.echo@0.1.0', status: 'pending_review', enabled: false } });
      }
      if (url.endsWith('/workflow-templates')) {
        return jsonResponse([{ template_id: 'rag_regression', name: 'RAG 回归评测', description: 'LLMCall + Judge', scenario: 'rag' }]);
      }
      if (url.endsWith('/workflow-drafts')) {
        if (init?.method === 'POST') {
          return jsonResponse({ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' });
        }
        return jsonResponse([{ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' }]);
      }
      if (url.endsWith('/workflows')) {
        return jsonResponse([demoWorkflowVersion]);
      }
      if (url.endsWith('/tasks')) {
        if (init?.method === 'POST') {
          return jsonResponse(demoTask);
        }
        return jsonResponse([demoTask]);
      }
      if (url.endsWith('/tasks/task-demo/execute')) {
        return jsonResponse({ ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8, badcase_count: 20 });
      }
      if (url.endsWith('/tasks/task-demo/report')) {
        return jsonResponse({
          task: { ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8, badcase_count: 20 },
          task_summary: { task_id: 'task-demo', task_name: 'RAG 任务', run_id: 'run-demo', status: 'completed', dataset_name: '问答回归集', workflow_name: 'RAG 回归评测', sample_count: 100, current_attempt: 1 },
          version_snapshot: {
            dataset: { dataset_id: 'dataset-demo', version: 1, version_id: 'dataset-demo:v1', name: '问答回归集' },
            workflow: { workflow_id: 'wf-demo', version_id: 'wf-demo:v1', name: 'RAG 回归评测', step_count: 2 },
            execution_config: demoTask.execution_config,
          },
          step_distribution: [
            { step_id: 'answer', skill_ref: 'llm.call@0.1.0', total_calls: 100, succeeded: 100, failed: 0, cache_hits: 0, total_latency_ms: 100, average_latency_ms: 1 },
          ],
          judge_score_distribution: [{ bucket: '0.8-1.0', count: 80 }],
          report: { run_id: 'run-demo', pass_rate: 0.8, error_rate: 0, p95_latency_ms: 12, metrics: {}, badcases: [demoBadcase] },
          badcases: [demoBadcase],
          export_links: { html: '/runs/run-demo/report/export?file_format=html', csv: '/runs/run-demo/report/export?file_format=csv', json: '/runs/run-demo/report/export?file_format=json' },
        });
      }
      if (url.endsWith('/runs') || url.endsWith('/datasets') || url.endsWith('/judge-profiles') || url.endsWith('/judge-audits')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/badcases') || url.endsWith('/audit-events')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/dashboard/summary')) {
        return jsonResponse({ dataset_count: 12, skill_count: 34, workflow_count: 5, run_count: 8, latest_run: null, pass_rate: 0.92, badcase_count: 7 });
      }
      if (url.endsWith('/experiments') || url.endsWith('/annotation-queue')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/workflow-graphs/validate')) {
        return jsonResponse({ ok: true, errors: [], warnings: [], execution_levels: [['answer'], ['judge']], graph_tips: [], node_count: 2, edge_count: 1 });
      }
      return jsonResponse({});
    });
  });

  it('展示主导航和开始评测入口', async () => {
    await renderWorkbench('/');

    expect(screen.getByText('AegisQA')).toBeInTheDocument();
    expect(screen.getByText('开始一次评测')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Workflow 市场/ })).toBeInTheDocument();
    expect(screen.getByText('最近 Run 状态')).toBeInTheDocument();
  });

  it('概览页读取真实 Dashboard 并展示产品化增强入口', async () => {
    await renderWorkbench('/');

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('Experiment 快照')).toBeInTheDocument();
    expect(screen.getByText('Assertion DSL')).toBeInTheDocument();
    expect(screen.getByText('CI Gate')).toBeInTheDocument();
    expect(screen.getByText('Annotation Queue')).toBeInTheDocument();
    expect(screen.getByText('Trace Tree')).toBeInTheDocument();
  });

  it('Workflow 市场展示草稿、已发布版本、模板和新建入口', async () => {
    await renderWorkbench('/workflows');

    expect(await screen.findByText('Workflow 市场')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建 Workflow/ })).toBeInTheDocument();
    expect(screen.getByText('测试草稿')).toBeInTheDocument();
    expect(screen.getByText('RAG 回归评测')).toBeInTheDocument();
    expect(screen.getByText(/模板/)).toBeInTheDocument();
  });

  it('Workflow 画布解释点对多和多对一流程', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect(screen.getByText('Skill Palette')).toBeInTheDocument();
    expect(screen.getByText('点对多')).toBeInTheDocument();
    expect(screen.getByText('多对一')).toBeInTheDocument();
    expect(screen.getByText('校验与试运行 Console')).toBeInTheDocument();
  });

  it('数据集上传入口点击后打开上传弹窗', async () => {
    await renderWorkbench('/datasets');

    fireEvent.click(screen.getByRole('button', { name: /上传 CSV \/ JSONL/ }));

    expect(await screen.findByText('上传数据集文件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交上传' })).toBeDisabled();
  });

  it('Workflow 设计器支持选择流程、删除节点和保存草稿入口', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect((await screen.findAllByLabelText('当前 Workflow'))[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存草稿/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删除选中/ })).toBeInTheDocument();

    const joinCountBefore = screen.getAllByText(/Join/).length;
    fireEvent.click(screen.getByRole('button', { name: /新增 Join/ }));
    await waitFor(() => expect(screen.getAllByText(/Join/).length).toBeGreaterThan(joinCountBefore));
  });

  it('Workflow 设计器支持撤销和重做节点操作', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(screen.getByRole('button', { name: /新增 Join/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /撤销/ })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(await screen.findByText(/已撤销/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(await screen.findByText(/已重做/)).toBeInTheDocument();
  });

  it('Workflow Inspector 支持查看并删除选中节点的下游连线', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /删除连线 answer -> judge_a/ }));

    expect(await screen.findByText(/已删除连线：answer-judge_a/)).toBeInTheDocument();
  });

  it('Workflow Inspector 支持选择下游节点并新增连线', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /删除连线 answer -> judge_a/ }));
    fireEvent.click(await screen.findByRole('button', { name: /连接到 judge_a/ }));

    expect(await screen.findByText(/已新增连线：answer-judge_a/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /删除连线 answer -> judge_a/ })).toBeInTheDocument();
  });

  it('Workflow Inspector 提供节点工具栏并支持键盘删除', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /删除当前节点/ }));
    expect(await screen.findByText(/已删除节点：answer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(await screen.findByText(/已撤销/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(await screen.findByText(/已删除节点：answer/)).toBeInTheDocument();
  });

  it('Workflow 发布失败时展示后端校验错误和修复入口', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/workflow-graphs/publish')) {
        return errorResponse(400, {
          code: 'HTTP_ERROR',
          message: 'Workflow Graph 校验失败',
          details: {
            errors: [{ code: 'BRANCH_CONDITION_REQUIRED', message: '条件分支必须配置条件表达式。', node_id: 'branch_low_score' }],
          },
          trace_id: 'trace_test',
        });
      }
      if (url.endsWith('/skills')) return jsonResponse(demoSkills);
      if (url.endsWith('/workflow-drafts')) return jsonResponse([{ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' }]);
      if (url.endsWith('/workflows')) return jsonResponse([demoWorkflowVersion]);
      if (url.endsWith('/workflow-templates') || url.endsWith('/datasets')) return jsonResponse([]);
      return jsonResponse({});
    });
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /发布/ }));
    expect(await screen.findByText(/发布失败：Workflow Graph 校验失败/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /错误与建议/ }));
    expect(await screen.findByText('BRANCH_CONDITION_REQUIRED')).toBeInTheDocument();
    expect(screen.getByText('条件分支必须配置条件表达式。')).toBeInTheDocument();
  });

  it('Workflow Aggregator 节点支持聚合策略配置', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(screen.getByRole('button', { name: /新增 Aggregator/ }));
    expect(await screen.findByText('聚合策略')).toBeInTheDocument();

    fireEvent.click(screen.getByText('均值'));
    expect(await screen.findByText(/聚合策略已更新：mean/)).toBeInTheDocument();
  });

  it('执行中心默认展示任务列表并可以创建任务', async () => {
    await renderWorkbench('/runs');

    expect(await screen.findByText('任务列表')).toBeInTheDocument();
    expect(screen.getByText('RAG 任务')).toBeInTheDocument();
    expect(screen.getByText('问答回归集')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /创建任务/ }));

    expect(await screen.findByText('创建任务')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认创建任务' })).toBeDisabled();
  });

  it('任务列表执行按钮会刷新任务状态', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: /执行/ }));

    expect(await screen.findByText(/任务状态已更新/)).toBeInTheDocument();
  });

  it('任务详情展示 Run Attempts 和执行参数', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: 'RAG 任务' }));

    expect(await screen.findByText('Run Attempts')).toBeInTheDocument();
    expect(screen.getByText(/#1 \/ queued \/ run-demo/)).toBeInTheDocument();
    expect(screen.getByText(/并发 2 \/ repeat 1 \/ 重试 1/)).toBeInTheDocument();
  });

  it('完成态任务不能重复执行', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/tasks')) {
        return jsonResponse([{ ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8 }]);
      }
      if (url.endsWith('/workflows')) {
        return jsonResponse([demoWorkflowVersion]);
      }
      if (url.endsWith('/datasets')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/task-trace-tree')) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/runs');

    expect(await screen.findByRole('button', { name: /执行/ })).toBeDisabled();
  });

  it('Skill 合约测试按钮会调用后端并展示结果', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse(demoSkills);
      }
      if (url.includes('/contract-test')) {
        return jsonResponse({ ok: true, skill_id: 'llm.call@0.1.0', latency_ms: 1, output: { answer: 'ok' }, metrics: {} });
      }
      return jsonResponse([]);
    });
    await renderWorkbench('/skills');

    fireEvent.click(screen.getByRole('button', { name: /上传 Skill 插件包/ }));
    expect(await screen.findByText('上传 Skill 插件包')).toBeInTheDocument();

    fireEvent.click((await screen.findAllByRole('button', { name: /查看详情/ }))[0]);
    fireEvent.click(screen.getByRole('button', { name: /运行合约测试/ }));

    expect(await screen.findByText(/合约测试通过/)).toBeInTheDocument();
  });

  it('报告中心围绕任务展示报告和导出入口', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();
    expect(screen.getByText('RAG 任务')).toBeInTheDocument();
    expect(screen.getByText('任务摘要与版本快照')).toBeInTheDocument();
    expect(screen.getByText('Step 分布与耗时')).toBeInTheDocument();
    expect(screen.getByText('answer')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /导出 HTML \/ CSV/ }));
    expect(await screen.findByText(/报告导出成功/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /忽略/ }));
    expect(await screen.findByText(/Badcase 已忽略/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重开/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /加入审阅队列/ })).toBeInTheDocument();
  });

  it('Judge 审计创建按钮打开审计表单', async () => {
    await renderWorkbench('/judge');

    fireEvent.click(screen.getByRole('button', { name: /创建审计/ }));

    expect(await screen.findByText('创建 Judge 审计')).toBeInTheDocument();
  });

  it('治理页面权限矩阵按钮打开矩阵弹窗', async () => {
    await renderWorkbench('/governance');

    fireEvent.click(screen.getByRole('button', { name: /查看权限矩阵/ }));

    expect(await screen.findByText('RBAC 权限矩阵')).toBeInTheDocument();
  });
});
