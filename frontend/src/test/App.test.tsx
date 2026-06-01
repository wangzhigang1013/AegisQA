import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  demoAnnotationCandidates,
  demoAnnotationTasks,
  demoBadcase,
  demoCIGateEvaluations,
  demoCIGates,
  demoDataset,
  demoExperiments,
  demoPromptSkillCandidate,
  demoRepairTask,
  demoReportExportRequest,
  demoScoreAnalytics,
  demoSkills,
  demoTask,
  demoTaskExecutionTemplates,
  demoTraceFlow,
  demoTraceTree,
  demoWorkflowGraph,
  demoWorkflowVersion,
  errorResponse,
  findComboboxByLabel,
  installDefaultWorkbenchMocks,
  jsonResponse,
  pendingPackageSkill,
  pendingSkillPackage,
  renderWorkbench,
} from './workbenchTestHarness';

describe('AegisQA 前端工作台', () => {
  installDefaultWorkbenchMocks();

  it('展示主导航和开始评测入口', async () => {
    await renderWorkbench('/');

    expect(screen.getByText('AegisQA')).toBeInTheDocument();
    expect(screen.getByText('开始一次评测')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Workflow 市场/ })).toBeInTheDocument();
    expect(screen.getAllByText('最近任务').length).toBeGreaterThan(0);
  });

  it('概览页读取真实 Dashboard 并展示产品化增强入口', async () => {
    await renderWorkbench('/');

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('Experiment 快照')).toBeInTheDocument();
    expect(screen.getByText('Assertion DSL')).toBeInTheDocument();
    expect(screen.getAllByText('CI Gate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Annotation Queue').length).toBeGreaterThan(0);
    expect(screen.getByText('Trace Tree')).toBeInTheDocument();
  });

  it('首页作为任务工作台展示待办队列和主流程入口', async () => {
    await renderWorkbench('/');

    expect(await screen.findByText('任务工作台')).toBeInTheDocument();
    expect(screen.getAllByText('最近任务').length).toBeGreaterThan(0);
    expect(screen.getByText('待审批 Skill')).toBeInTheDocument();
    expect(screen.getByText('待审核样本')).toBeInTheDocument();
    expect(screen.getByText('失败任务')).toBeInTheDocument();
    expect(screen.getByText(/CI Gate 阻断/)).toBeInTheDocument();
    expect(screen.getByText('RAG 任务')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /上传数据/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /选择 Workflow/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /创建任务/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /查看报告/ }).length).toBeGreaterThan(0);
  });

  it('Workflow 市场展示草稿、已发布版本、模板和新建入口', async () => {
    await renderWorkbench('/workflows');

    expect(await screen.findByText('Workflow 市场')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建 Workflow/ })).toBeInTheDocument();
    expect(await screen.findByText('测试草稿')).toBeInTheDocument();
    expect(await screen.findByText('RAG 回归评测')).toBeInTheDocument();
    expect(screen.getByText(/模板/)).toBeInTheDocument();
  });

  it('Workflow 市场支持删除草稿、复制草稿和按状态筛选', async () => {
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const requests: { url: string; method?: string; body?: string }[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method, body: String(init?.body ?? '') });
      if (url.endsWith('/workflow-drafts/draft-test') && init?.method === 'DELETE') {
        return jsonResponse({ draft_id: 'draft-test', status: 'deleted', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' });
      }
      if (url.endsWith('/workflow-drafts') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}'));
        return jsonResponse({ draft_id: 'draft-copy', status: 'draft', name: body.name, graph: body.graph, created_at: '', updated_at: '' });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/workflows');

    await screen.findByText('Workflow 列表');
    fireEvent.mouseDown(findComboboxByLabel('Workflow 状态筛选'));
    const draftOption = (await screen.findAllByText('草稿')).find((element) => element.closest('.ant-select-item-option'));
    expect(draftOption).toBeTruthy();
    fireEvent.click(draftOption!);
    expect(await screen.findByText('测试草稿')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /复制草稿/ }));
    await waitFor(() => {
      expect(requests.some((request) => request.url.endsWith('/workflow-drafts') && request.method === 'POST' && (request.body ?? '').includes('测试草稿 副本'))).toBe(true);
    });
    expect(await screen.findByText(/Workflow 草稿已复制/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /删除草稿/ }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(requests.some((request) => request.url.endsWith('/workflow-drafts/draft-test') && request.method === 'DELETE')).toBe(true);
    });
    expect(await screen.findByText(/草稿已删除/)).toBeInTheDocument();
  });

  it('Workflow 画布解释点对多和多对一流程', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect(await screen.findByText('Skill Palette')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索 Skill 名称、描述、标签或 schema')).toBeInTheDocument();
    expect(screen.getByText('点对多')).toBeInTheDocument();
    expect(screen.getByText('多对一')).toBeInTheDocument();
    expect(screen.getByText('校验与试运行 Console')).toBeInTheDocument();
  });

  it('Workflow Skill Palette 通过语义搜索添加 Skill，并阻止未启用 Skill', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse([...demoSkills, pendingPackageSkill]);
      }
      if (url.endsWith('/workflow-drafts/draft-test')) return jsonResponse({ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' });
      if (url.endsWith('/workflow-drafts')) return jsonResponse([{ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' }]);
      if (url.endsWith('/workflows')) return jsonResponse([demoWorkflowVersion]);
      if (url.endsWith('/workflow-templates') || url.endsWith('/datasets')) return jsonResponse([demoDataset]);
      return jsonResponse([]);
    });

    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.change(await screen.findByPlaceholderText('搜索 Skill 名称、描述、标签或 schema'), { target: { value: 'score reference' } });
    expect(await screen.findByText('Deterministic LLM Judge')).toBeInTheDocument();
    expect(screen.getByText(/输入 3 \/ 输出 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看详情/ }));
    expect(await screen.findByRole('dialog', { name: /Skill 详情：Deterministic LLM Judge/ })).toBeInTheDocument();
    expect(screen.getByText('llm.judge@0.1.0')).toBeInTheDocument();
    expect(screen.getByText('输入 Schema')).toBeInTheDocument();
    expect(screen.getByText('输出 Schema')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('搜索 Skill 名称、描述、标签或 schema'), { target: { value: 'echo plugin' } });
    expect(await screen.findByText('Echo 插件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /添加 Echo 插件/ })).toBeDisabled();
    expect(screen.getByText(/请先在 Skill 市场运行合约测试并审批启用/)).toBeInTheDocument();
  });

  it('数据集上传入口点击后打开上传弹窗', async () => {
    await renderWorkbench('/datasets');

    fireEvent.click(screen.getByRole('button', { name: /上传 CSV \/ JSONL/ }));

    expect(await screen.findByText('上传数据集文件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交上传' })).toBeDisabled();
  });

  it('数据集页可以打开 Lineage 抽屉查看来源和下游任务', async () => {
    await renderWorkbench('/datasets');

    fireEvent.click(await screen.findByRole('button', { name: /查看 Lineage/ }));

    expect(await screen.findByText('数据血缘')).toBeInTheDocument();
    expect(await screen.findByText('file_upload')).toBeInTheDocument();
    expect(await screen.findByText('trusted.jsonl')).toBeInTheDocument();
    expect(await screen.findByText('可信评测任务')).toBeInTheDocument();
  });

  it('Workflow 设计器支持选择流程、删除节点和保存草稿入口', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect((await screen.findAllByLabelText('加载已有流程'))[0]).toBeInTheDocument();
    expect(screen.getByText('当前草稿：draft-test')).toBeInTheDocument();
    expect(screen.getByText('已保存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存草稿/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /返回市场/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删除选中/ })).toBeInTheDocument();

    const joinCountBefore = screen.getAllByText(/Join/).length;
    fireEvent.click(screen.getByRole('button', { name: /新增 Join/ }));
    await waitFor(() => expect(screen.getAllByText(/Join/).length).toBeGreaterThan(joinCountBefore));
  });

  it('Workflow 设计器支持撤销和重做节点操作', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    const joinCountBefore = screen.getAllByText(/Join/).length;
    fireEvent.click(screen.getByRole('button', { name: /新增 Join/ }));
    await waitFor(() => expect(screen.getAllByText(/Join/).length).toBeGreaterThan(joinCountBefore));
    await waitFor(() => expect(screen.getByRole('button', { name: /撤销/ })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(await screen.findByText(/已撤销/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(await screen.findByText(/已重做/)).toBeInTheDocument();
  }, 20_000);

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

  it('Workflow 发布失败时展示后端校验错误、顶部提示和修复入口', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/workflow-drafts/draft-test/publish')) {
        return errorResponse(400, {
          code: 'HTTP_ERROR',
          message: 'Workflow Graph 校验失败',
          details: {
            errors: [
              {
                code: 'REQUIRED_INPUT_MAPPING_MISSING',
                message: 'Skill 必填输入未配置字段映射：prompt',
                node_id: 'answer',
                details: { missing_fields: ['prompt'] },
              },
              {
                code: 'SKILL_NOT_FOUND',
                message: '未注册的 Skill：missing.skill@9.9.9',
                node_id: 'answer',
                details: { skill_ref: 'missing.skill@9.9.9' },
              },
              {
                code: 'CONFIG_REQUIRED_MISSING',
                message: 'Skill 必填参数未配置：model',
                node_id: 'answer',
                details: { missing_fields: ['model'] },
              },
              {
                code: 'CONFIG_VALUE_INVALID',
                message: 'Skill 参数 temperature 类型不匹配：期望 number，实际 string',
                node_id: 'answer',
                details: { field_path: 'temperature', expected_type: 'number', actual_type: 'string' },
              },
              {
                code: 'CONFIG_EXPRESSION_PATH_MISSING',
                message: '路径不存在：row.temperature',
                node_id: 'answer',
                details: { field_path: 'temperature', row_index: 1 },
              },
              {
                code: 'CONFIG_SECRET_REF_EMPTY',
                message: 'Skill 参数 api_key 的 Secret 名称不能为空',
                node_id: 'answer',
                details: { field_path: 'api_key' },
              },
            ],
          },
          trace_id: 'trace_test',
        });
      }
      if (url.endsWith('/workflow-graphs/validate')) return jsonResponse({ ok: true, errors: [], warnings: [], execution_levels: [['answer']], graph_tips: [], node_count: 2, edge_count: 1 });
      if (url.endsWith('/skills')) return jsonResponse(demoSkills);
      if (url.endsWith('/workflow-drafts/draft-test')) return jsonResponse({ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' });
      if (url.endsWith('/workflow-drafts')) return jsonResponse([{ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' }]);
      if (url.endsWith('/workflows')) return jsonResponse([demoWorkflowVersion]);
      if (url.endsWith('/workflow-templates') || url.endsWith('/datasets')) return jsonResponse([]);
      return jsonResponse({});
    });
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /发布/ }));
    expect(await screen.findByText(/发布失败：Workflow Graph 校验失败/)).toBeInTheDocument();
    expect(screen.getByText('发布失败，请查看错误与建议')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /错误与建议/ }));
    expect(await screen.findByText('REQUIRED_INPUT_MAPPING_MISSING')).toBeInTheDocument();
    expect(screen.getByText('Skill 必填输入未配置字段映射：prompt')).toBeInTheDocument();
    expect(screen.getByText(/在右侧 Inspector 的输入绑定中为缺失字段配置/)).toBeInTheDocument();
    expect(screen.getByText('SKILL_NOT_FOUND')).toBeInTheDocument();
    expect(screen.getByText(/到 Skill 市场上传或选择已注册的 Skill/)).toBeInTheDocument();
    expect(screen.getByText('CONFIG_REQUIRED_MISSING')).toBeInTheDocument();
    expect(screen.getByText(/在右侧 Inspector 的运行参数中补齐必填参数/)).toBeInTheDocument();
    expect(screen.getByText('CONFIG_VALUE_INVALID')).toBeInTheDocument();
    expect(screen.getByText(/将参数 temperature 改为 number 类型/)).toBeInTheDocument();
    expect(screen.getByText('CONFIG_EXPRESSION_PATH_MISSING')).toBeInTheDocument();
    expect(screen.getByText(/检查 Dataset 预览样本第 2 行/)).toBeInTheDocument();
    expect(screen.getByText('CONFIG_SECRET_REF_EMPTY')).toBeInTheDocument();
    expect(screen.getByText(/填写 Secret 引用名称/)).toBeInTheDocument();
  });

  it('Workflow 发布成功时优先发布草稿并展示下一步入口', async () => {
    const publishRequests: string[] = [];
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/workflow-drafts/draft-test/publish')) {
        publishRequests.push(url);
        return jsonResponse({ ...demoWorkflowVersion, version_id: 'wf-published:v3', version: 3 });
      }
      if (url.endsWith('/workflow-graphs/validate')) return jsonResponse({ ok: true, errors: [], warnings: [], execution_levels: [['answer']], graph_tips: [], node_count: 2, edge_count: 1 });
      return defaultFetch?.(input, init) ?? jsonResponse({});
    });

    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /发布/ }));

    expect((await screen.findAllByText('发布成功：wf-published:v3')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /去创建任务/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /返回 Workflow 市场/ })).toBeInTheDocument();
    expect(publishRequests).toEqual(expect.arrayContaining([expect.stringContaining('/workflow-drafts/draft-test/publish')]));
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) => String(input).endsWith('/workflow-graphs/publish'))).toBe(false);
  });

  it('Workflow Aggregator 节点支持聚合策略配置', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /新增 Aggregator/ }));
    expect(await screen.findByText('聚合策略')).toBeInTheDocument();

    fireEvent.click(screen.getByText('均值'));
    expect(await screen.findByText(/聚合策略已更新：mean/)).toBeInTheDocument();
  });

  it('Workflow Inspector 支持字段路径选择和参数预览', async () => {
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse(demoSkills.map((skill) => (
          skill.skill_id === 'llm.call@0.1.0'
            ? { ...skill, output_schema: { ...skill.output_schema, required: ['answer'] } }
            : skill
        )));
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/workflows/designer/draft-test');

    expect(await screen.findByText('输入绑定')).toBeInTheDocument();
    expect(screen.getByText('输出写入')).toBeInTheDocument();
    expect(screen.getByText('运行参数')).toBeInTheDocument();
    expect(screen.getByText('输入字段 prompt')).toBeInTheDocument();
    expect(screen.getByText('输出字段 answer')).toBeInTheDocument();
    expect(screen.getByText('必填输入')).toBeInTheDocument();
    expect(screen.getByText('Skill 必返输出')).toBeInTheDocument();
    expect(screen.getByText(/Skill 必返输出表示 handler 会返回该字段/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('row.question')).toBeInTheDocument();
    expect(screen.getByDisplayValue('context.answer')).toBeInTheDocument();
    expect(screen.getByText(/未写入的输出不会传给下游/)).toBeInTheDocument();
    expect(screen.queryByLabelText('输入映射 JSON')).not.toBeInTheDocument();

    const clickDatasetOption = async () => {
      const datasetOption = (await screen.findAllByText('问答回归集 v1')).find((element) => element.closest('.ant-select-item-option'));
      expect(datasetOption).toBeTruthy();
      fireEvent.click(datasetOption!);
    };

    fireEvent.mouseDown(findComboboxByLabel('映射预览数据集 / 试运行数据集'));
    await clickDatasetOption();
    expect(await screen.findByText('数据集字段预览')).toBeInTheDocument();
    expect(screen.getByText('row.question')).toBeInTheDocument();
    expect(screen.getByText('AI 评测平台')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '参数预览' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择参数预览数据集' }));
    await clickDatasetOption();
    fireEvent.click(screen.getByRole('button', { name: /预览参数/ }));

    expect(await screen.findByText('mock-model')).toBeInTheDocument();
    expect(screen.getAllByText(/workflow_config/).length).toBeGreaterThan(0);
  });

  it('Workflow 试运行未选择数据集时禁用并说明用途', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect(await screen.findByText('映射预览数据集 / 试运行数据集')).toBeInTheDocument();
    expect(screen.getByText(/选择后会驱动输入绑定候选、参数预览和试运行抽样/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /试运行/ })).toBeDisabled();
    expect(screen.getByText('请选择映射预览数据集')).toBeInTheDocument();
  });

  it('执行中心默认展示任务列表并可以创建任务', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await renderWorkbench('/runs');
      expect(await screen.findByText('任务列表')).toBeInTheDocument();
      expect(screen.getByText('RAG 任务')).toBeInTheDocument();
      expect(screen.getByText('问答回归集')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /创建任务/ }));

      expect(await screen.findByText('创建任务')).toBeInTheDocument();
      expect(screen.getByText('评测目的')).toBeInTheDocument();
      expect(screen.getByText('质量门槛')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /运行 Preflight/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: '确认创建任务' })).toBeDisabled();

      fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '上线门禁任务' } });
      fireEvent.mouseDown(screen.getAllByLabelText('Dataset Version')[0]);
      fireEvent.click(await screen.findByText('问答回归集 v1 / 100 条'));
      fireEvent.mouseDown(screen.getAllByLabelText('Workflow Version')[0]);
      fireEvent.click(await screen.findByText('RAG 回归评测 v1'));
      expect(screen.getByRole('button', { name: /运行 Preflight/ })).not.toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));
      expect((await screen.findAllByText(/Preflight 通过/)).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: '确认创建任务' })).not.toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));
      expect(await screen.findByText(/任务已创建/)).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const errorText = consoleError.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(errorText).not.toContain('Instance created by `useForm` is not connected');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('执行中心任务列表使用服务端分页和状态筛选', async () => {
    const manyTasks = Array.from({ length: 12 }, (_, index) => ({
      ...demoTask,
      task_id: `task-page-${String(index).padStart(2, '0')}`,
      name: `分页任务 ${String(index).padStart(2, '0')}`,
      status: index % 2 === 0 ? 'completed' : 'queued',
      completed_items: index % 2 === 0 ? 100 : 0,
    }));
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const taskRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      const parsed = new URL(url, 'http://localhost');
      if (parsed.pathname.endsWith('/tasks') && init?.method !== 'POST') {
        taskRequests.push(url);
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 8);
        const status = parsed.searchParams.get('status');
        const q = parsed.searchParams.get('q');
        const filtered = manyTasks
          .filter((task) => (status ? task.status === status : true))
          .filter((task) => (q ? task.name.includes(q) || task.dataset_name.includes(q) || task.workflow_name.includes(q) : true));
        const start = (page - 1) * pageSize;
        return jsonResponse({
          items: filtered.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: filtered.length, total_pages: Math.ceil(filtered.length / pageSize) },
        });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/runs');

    expect(await screen.findByText('分页任务 00')).toBeInTheDocument();
    expect(screen.queryByText('分页任务 08')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(taskRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('分页任务 08')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('搜索任务名 / 数据源 / Workflow'), { target: { value: '分页任务 11' } });
    await waitFor(() => {
      expect(taskRequests.some((request) => request.includes('q=%E5%88%86%E9%A1%B5%E4%BB%BB%E5%8A%A1+11') && request.includes('page=1') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('分页任务 11')).toBeInTheDocument();

    fireEvent.mouseDown(findComboboxByLabel('任务状态筛选'));
    const completedOptions = await screen.findAllByText('completed');
    fireEvent.click(completedOptions[completedOptions.length - 1]);
    await waitFor(() => {
      expect(taskRequests.some((request) => request.includes('status=completed') && request.includes('page=1'))).toBe(true);
    });
  });

  it('执行中心选择执行模板后创建任务会提交模板 ID', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: /创建任务/ }));
    fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '模板化上线门禁' } });
    fireEvent.mouseDown(findComboboxByLabel('执行参数模板'));
    fireEvent.click(await screen.findByText('上线门禁稳健模板 / 内置'));
    fireEvent.mouseDown(screen.getAllByLabelText('Dataset Version')[0]);
    fireEvent.click(await screen.findByText('问答回归集 v1 / 100 条'));
    fireEvent.mouseDown(screen.getAllByLabelText('Workflow Version')[0]);
    fireEvent.click(await screen.findByText('RAG 回归评测 v1'));

    fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));
    expect((await screen.findAllByText(/Preflight 通过/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));
    expect(await screen.findByText(/任务已创建/)).toBeInTheDocument();

    const createTaskCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input, init]) => String(input).endsWith('/tasks') && init?.method === 'POST');
    const body = JSON.parse(String(createTaskCall?.[1]?.body ?? '{}'));
    expect(body.execution_template_id).toBe('release_gate_safe');
    expect(body.preflight_id).toBe('preflight-demo');
    expect(body.preflight_result.execution_template_id).toBe('release_gate_safe');
  });

  it('执行中心创建任务会提交任务级 Skill 参数覆盖', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: /创建任务/ }));
    fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '覆盖参数上线任务' } });
    fireEvent.mouseDown(screen.getAllByLabelText('Dataset Version')[0]);
    fireEvent.click(await screen.findByText('问答回归集 v1 / 100 条'));
    fireEvent.mouseDown(screen.getAllByLabelText('Workflow Version')[0]);
    fireEvent.click(await screen.findByText('RAG 回归评测 v1'));
    fireEvent.click(screen.getByRole('button', { name: '添加任务级参数覆盖' }));
    fireEvent.mouseDown(findComboboxByLabel('覆盖 Step'));
    const stepOptions = await screen.findAllByText('生成回答 / answer');
    fireEvent.click(stepOptions[stepOptions.length - 1]);
    fireEvent.mouseDown(findComboboxByLabel('参数名'));
    const parameterOptions = await screen.findAllByText('model / string');
    fireEvent.click(parameterOptions[parameterOptions.length - 1]);
    fireEvent.change(screen.getByPlaceholderText('覆盖值'), { target: { value: 'task-model' } });

    fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));
    expect((await screen.findAllByText(/Preflight 通过/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));
    expect(await screen.findByText(/任务已创建/)).toBeInTheDocument();

    const createTaskCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input, init]) => String(input).endsWith('/tasks') && init?.method === 'POST');
    const body = JSON.parse(String(createTaskCall?.[1]?.body ?? '{}'));
    expect(body.skill_overrides).toEqual({ answer: { model: 'task-model' } });
    expect(body.preflight_result.skill_overrides).toEqual({ answer: { model: 'task-model' } });
  });

  it('Trace Flow 页面展示样本数据、参数来源和队列消息形状', async () => {
    await renderWorkbench('/tasks/task-demo/trace');

    expect(await screen.findByText('Trace Flow')).toBeInTheDocument();
    expect(screen.getByText('问答回归集')).toBeInTheDocument();
    expect(screen.getByText('item_id')).toBeInTheDocument();
    expect(screen.getByText('item-demo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Steps' }));
    fireEvent.click(await screen.findByRole('tab', { name: '参数' }));
    expect(screen.getByText(/workflow_config/)).toBeInTheDocument();
  });

  it('Trace Flow 样本列表使用服务端分页，避免大任务一次性传输全部样本', async () => {
    const manyTraceItems = Array.from({ length: 12 }, (_, index) => ({
      ...demoTraceFlow.items[0],
      item_id: `trace-item-${index}`,
      row_id: `row-${index}`,
      row_index: index,
      row: { question: `问题 ${index}`, reference: 'AegisQA' },
    }));
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const traceRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/tasks/task-demo/trace-flow')) {
        traceRequests.push(url);
        const parsed = new URL(url, 'http://localhost');
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 12);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          ...demoTraceFlow,
          items: manyTraceItems.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyTraceItems.length, total_pages: Math.ceil(manyTraceItems.length / pageSize) },
        });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/tasks/task-demo/trace');

    expect(await screen.findByText('trace-item-0')).toBeInTheDocument();
    expect(screen.getByText('trace-item-7')).toBeInTheDocument();
    expect(screen.queryByText('trace-item-8')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(traceRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('trace-item-8')).toBeInTheDocument();
  });

  it('Trace Tree 独立页面展示 Item 到 Skill Step 的调用树', async () => {
    await renderWorkbench('/tasks/task-demo/trace-tree');

    expect(await screen.findByText('Trace Tree')).toBeInTheDocument();
    expect(screen.getByText('run-demo')).toBeInTheDocument();
    expect(screen.getAllByText('answer').length).toBeGreaterThan(0);
    expect(screen.getByText('llm.call@0.1.0')).toBeInTheDocument();
  });

  it('Trace Tree 调用树使用服务端分页，避免一次性传输全部调用明细', async () => {
    const manyTraceTreeItems = Array.from({ length: 12 }, (_, index) => ({
      ...demoTraceTree.items[0],
      item_id: `tree-item-${index}`,
      row_id: `row-${index}`,
      metrics: { judge_score: index / 10 },
    }));
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const traceTreeRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/tasks/task-demo/trace-tree')) {
        traceTreeRequests.push(url);
        const parsed = new URL(url, 'http://localhost');
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 12);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          ...demoTraceTree,
          items: manyTraceTreeItems.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyTraceTreeItems.length, total_pages: Math.ceil(manyTraceTreeItems.length / pageSize) },
        });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/tasks/task-demo/trace-tree');

    expect(await screen.findByText('tree-item-0')).toBeInTheDocument();
    expect(screen.getByText('tree-item-7')).toBeInTheDocument();
    expect(screen.queryByText('tree-item-8')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(traceTreeRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('tree-item-8')).toBeInTheDocument();
  });

  it('任务列表执行按钮会刷新任务状态', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: /执行/ }));

    expect(await screen.findByText(/任务状态已更新/)).toBeInTheDocument();
  });

  it('任务详情展示 Run Attempts 和执行参数', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: 'RAG 任务' }));

    fireEvent.click(await screen.findByRole('tab', { name: 'Attempts' }));
    expect(await screen.findByText('Run Attempts')).toBeInTheDocument();
    expect(screen.getByText(/#1 \/ queued \/ run-demo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '参数' }));
    expect(screen.getAllByText(/并发 2 \/ repeat 1 \/ 重试 1/).length).toBeGreaterThan(0);
  });

  it('任务详情参数页展示创建前 Preflight 证据', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: 'RAG 任务' }));
    fireEvent.click(await screen.findByRole('tab', { name: '参数' }));

    expect(await screen.findByText('创建前 Preflight 证据')).toBeInTheDocument();
    expect(screen.getAllByText('preflight-demo').length).toBeGreaterThan(0);
    expect(screen.getByText('预检通过，可以创建并执行任务。')).toBeInTheDocument();
    expect(screen.getByText('数据集非空')).toBeInTheDocument();
    expect(screen.getByText('Workflow 字段映射')).toBeInTheDocument();
  });

  it('任务详情驾驶舱按概览、样本、Trace、Badcase、Attempts 和参数组织', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: 'RAG 任务' }));

    expect(await screen.findByRole('tab', { name: '概览' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '样本' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Trace' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Badcase' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Attempts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '参数' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '参数' }));
    expect(await screen.findByText('任务冻结参数')).toBeInTheDocument();
    expect(screen.getByText('Skill 参数来源')).toBeInTheDocument();
    expect(screen.getByText(/cost_budget/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Trace' }));
    expect(await screen.findByText('Trace Tree')).toBeInTheDocument();
  });

  it('任务详情 Badcase 表分页，避免大任务一次性渲染全部坏例', async () => {
    const manyBadcases = Array.from({ length: 12 }, (_, index) => ({
      ...demoBadcase,
      badcase_id: `badcase-${index}`,
      item_id: `item-${index}`,
      reason: `reason-${index}`,
    }));
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/tasks/task-demo/report') || url.includes('/tasks/task-demo/report?')) {
        return jsonResponse({ badcases: manyBadcases });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: 'RAG 任务' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Badcase' }));

    expect(await screen.findByText('item-0')).toBeInTheDocument();
    expect(screen.getByText('item-7')).toBeInTheDocument();
    expect(screen.queryByText('item-8')).not.toBeInTheDocument();
  });

  it('完成态任务不能重复执行', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      const parsed = new URL(url, 'http://localhost');
      if (parsed.pathname.endsWith('/tasks')) {
        const completedTask = { ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8 };
        if (parsed.searchParams.has('page')) {
          return jsonResponse({
            items: [completedTask],
            pagination: { page: 1, page_size: 8, total_items: 1, total_pages: 1 },
          });
        }
        return jsonResponse([completedTask]);
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
    expect(screen.getByText('合约测试做什么')).toBeInTheDocument();
    expect(screen.getByText(/使用 Skill manifest 里的 example_input 和 example_config/)).toBeInTheDocument();
    expect(screen.getByText('测试输入')).toBeInTheDocument();
    expect(screen.getByText('测试配置')).toBeInTheDocument();
    expect(screen.getByText('输出结果')).toBeInTheDocument();
    expect(screen.getByText('耗时')).toBeInTheDocument();
  });

  it('Skill 合约测试失败时展示修复建议和插件审批步骤', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse([pendingPackageSkill]);
      }
      if (url.endsWith('/skills/packages')) {
        return jsonResponse([pendingSkillPackage]);
      }
      if (url.includes('/contract-test')) {
        return jsonResponse({ ok: false, skill_id: 'plugin.echo@0.1.0', error: 'ValidationError', message: 'output.echo 缺失', code: 'TYPE_MISMATCH' });
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/skills');

    fireEvent.click(await screen.findByRole('button', { name: /查看详情/ }));
    expect(await screen.findByText('插件启用步骤')).toBeInTheDocument();
    expect(screen.getByText('第 2 步：运行合约测试')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /运行合约测试/ }));

    expect((await screen.findAllByText(/合约测试失败/)).length).toBeGreaterThan(0);
    expect(screen.getByText('错误码')).toBeInTheDocument();
    expect(screen.getByText('TYPE_MISMATCH')).toBeInTheDocument();
    expect(screen.getByText(/检查 skill.yaml\/skill.json/)).toBeInTheDocument();
    expect(screen.getByText(/检查 handler.py 的 run\(inputs, config\)/)).toBeInTheDocument();
  });

  it('Skill 市场展示插件包审批状态、合约测试状态和审批信息', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse([...demoSkills, pendingPackageSkill]);
      }
      if (url.endsWith('/skills/packages')) {
        return jsonResponse([pendingSkillPackage]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/skills');

    expect(await screen.findByText('Echo 插件')).toBeInTheDocument();
    expect(screen.getByText('待审批')).toBeInTheDocument();
    expect(screen.getByText('合约未通过')).toBeInTheDocument();
    expect(screen.getByText('未审批')).toBeInTheDocument();
  });

  it('治理页审批抽屉展示 manifest、schema 和未通过合约测试禁用原因', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse([pendingPackageSkill]);
      }
      if (url.endsWith('/skills/packages')) {
        return jsonResponse([pendingSkillPackage]);
      }
      if (url.endsWith('/audit-events')) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/governance');

    const approvalButtons = await screen.findAllByRole('button', { name: /审批详情/ });
    fireEvent.click(approvalButtons[approvalButtons.length - 1]);

    expect(await screen.findByText('Skill 审批详情')).toBeInTheDocument();
    expect(screen.getByText('Manifest')).toBeInTheDocument();
    expect(screen.getByText('输入 Schema')).toBeInTheDocument();
    expect(screen.getByText('未通过合约测试不能启用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /审批启用/ })).toBeDisabled();
  });

  it('Experiment 页面展示实验快照、baseline 对比和创建入口', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/experiments/from-run') && init?.method === 'POST') {
        return jsonResponse({ ...demoExperiments[0], experiment_id: 'exp-created', name: '新实验快照' });
      }
      if (url.includes('/experiments')) {
        return jsonResponse(demoExperiments);
      }
      if (url.endsWith('/runs')) {
        return jsonResponse([{ ...demoTask, run_id: 'run-demo', status: 'completed' }]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/experiments');

    expect(await screen.findByText('Experiment 实验中心')).toBeInTheDocument();
    expect(screen.getAllByText('主链路实验').length).toBeGreaterThan(0);
    expect(screen.getByText('Baseline 对比')).toBeInTheDocument();
    expect(screen.getByText('通过率变化')).toBeInTheDocument();
    expect(screen.getByText('失败样本变化')).toBeInTheDocument();
    expect(screen.getByText('P95 耗时变化')).toBeInTheDocument();
    expect(screen.getByText('成本变化')).toBeInTheDocument();
    expect(screen.getByText('Dataset 过滤')).toBeInTheDocument();
    expect(screen.getByText('Workflow 过滤')).toBeInTheDocument();
    expect(screen.getByText('失败分布对比')).toBeInTheDocument();
    expect(screen.getByText('judge_label=fail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /生成实验快照/ }));
    expect(await screen.findByText('从 Run 生成实验快照')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认生成' })).toBeDisabled();
  });

  it('CI Gate 页面支持创建配置并对任务执行阻断评估', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/ci-gates') && init?.method === 'POST') {
        return jsonResponse({ ...demoCIGates[0], config_id: 'gatecfg-created', name: '新质量门禁' });
      }
      if (url.endsWith('/ci-gates')) {
        return jsonResponse(demoCIGates);
      }
      if (url.endsWith('/ci-gates/evaluate')) {
        return jsonResponse(demoCIGateEvaluations[0]);
      }
      if (url.includes('/ci-gates/evaluations')) {
        const parsed = new URL(url, 'http://localhost');
        return jsonResponse({
          items: demoCIGateEvaluations,
          pagination: { page: Number(parsed.searchParams.get('page') ?? 1), page_size: 6, total_items: demoCIGateEvaluations.length, total_pages: 1 },
          summary: { total_evaluations: demoCIGateEvaluations.length, blocked: 1, passed: 0, latest_status: 'blocked' },
        });
      }
      if (url.endsWith('/tasks')) {
        return jsonResponse([demoTask]);
      }
      if (url.endsWith('/runs')) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/ci-gates');

    expect(await screen.findByText('CI Gate 质量门禁')).toBeInTheDocument();
    expect(screen.getAllByText('发布质量门禁').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /创建质量门禁/ })).toBeInTheDocument();
    expect(screen.getByText('评估历史')).toBeInTheDocument();
    expect(screen.getByText('历史趋势')).toBeInTheDocument();
    expect(screen.getByText('gateeval-demo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /创建质量门禁/ }));
    expect(await screen.findByText('新建质量门禁配置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /执行 Gate 评估/ }));
    expect(await screen.findByText('阻断原因')).toBeInTheDocument();
    expect(screen.getAllByText(/质量门禁未通过/).length).toBeGreaterThan(0);
  });

  it('CI Gate 评估历史使用服务端分页并保留全量摘要', async () => {
    const manyEvaluations = Array.from({ length: 12 }, (_, index) => ({
      ...demoCIGateEvaluations[0],
      evaluation_id: `gateeval-page-${String(index).padStart(2, '0')}`,
      status: index % 4 === 0 ? 'blocked' : 'passed',
      blocking_failures: index % 4 === 0 ? 1 : 0,
      created_at: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    const evaluationRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/ci-gates')) {
        return jsonResponse(demoCIGates);
      }
      if (url.includes('/ci-gates/evaluations')) {
        const parsed = new URL(url, 'http://localhost');
        evaluationRequests.push(url);
        if (!parsed.searchParams.has('page')) {
          return jsonResponse(manyEvaluations);
        }
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 6);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          items: manyEvaluations.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyEvaluations.length, total_pages: Math.ceil(manyEvaluations.length / pageSize) },
          summary: { total_evaluations: manyEvaluations.length, blocked: 3, passed: 9, latest_status: 'blocked' },
        });
      }
      if (url.endsWith('/tasks')) {
        return jsonResponse([demoTask]);
      }
      if (url.endsWith('/runs')) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/ci-gates');

    expect(await screen.findByText('gateeval-page-00')).toBeInTheDocument();
    expect(screen.queryByText('gateeval-page-06')).not.toBeInTheDocument();
    expect(screen.getByText('历史评估')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(evaluationRequests.some((request) => request.includes('page=2') && request.includes('page_size=6'))).toBe(true);
    });
    expect(await screen.findByText('gateeval-page-06')).toBeInTheDocument();
  });

  it('Annotation Queue 页面支持来源任务筛选、领取和审核回流', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/annotation-queue/anno-demo/assign')) {
        return jsonResponse({ ...demoAnnotationTasks[0], status: 'assigned', assignee: 'current_user' });
      }
      if (url.includes('/annotation-queue/anno-demo/review')) {
        return jsonResponse({ ...demoAnnotationTasks[0], status: 'reviewed', review: { human_label: 'fail', add_to_golden: true } });
      }
      if (url.includes('/annotation-queue/bulk-review')) {
        return jsonResponse({
          reviewed_count: 1,
          tasks: [{ ...demoAnnotationTasks[0], status: 'reviewed', review: { human_label: 'fail', add_to_golden: true } }],
          candidate_summary: { golden: 1, assertion: 1 },
          candidates: demoAnnotationCandidates,
        });
      }
      if (url.includes('/annotation-candidates')) {
        return jsonResponse(demoAnnotationCandidates);
      }
      if (url.includes('/annotation-queue')) {
        return jsonResponse({
          items: demoAnnotationTasks,
          pagination: { page: 1, page_size: 8, total_items: demoAnnotationTasks.length, total_pages: 1 },
        });
      }
      if (url.endsWith('/tasks')) {
        return jsonResponse([demoTask]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/annotation-queue');

    expect(await screen.findByText('Annotation Queue 人工审核')).toBeInTheDocument();
    expect(screen.getByText('RAG 任务')).toBeInTheDocument();
    expect(screen.getByText('低分或失败样本需要人工复核')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('按负责人筛选')).toBeInTheDocument();
    expect(screen.getByText(/候选资产来自已审核样本/)).toBeInTheDocument();
    expect(screen.getByText(/Golden 1 \/ Assertion 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /领取/ }));
    expect(await screen.findByText(/样本已领取/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /audit 审核/ }));
    expect(await screen.findByText('审核样本')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确认审核/ })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('例如：pass / fail'), { target: { value: 'fail' } });
    fireEvent.click(screen.getByLabelText('回流 Golden Dataset'));
    fireEvent.click(screen.getByRole('button', { name: /确认审核/ }));

    expect(await screen.findByText(/审核已提交，并回流 Golden/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /批量审核/ }));
    expect(await screen.findByText('批量审核样本')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('批量标签，例如：pass / fail'), { target: { value: 'fail' } });
    fireEvent.click(screen.getByLabelText('批量回流 Golden Dataset'));
    fireEvent.click(screen.getByRole('button', { name: /确认批量审核/ }));
    expect(await screen.findByText(/批量审核完成/)).toBeInTheDocument();
  });

  it('Annotation Queue 审核队列使用服务端分页', async () => {
    const manyAnnotationTasks = Array.from({ length: 12 }, (_, index) => ({
      ...demoAnnotationTasks[0],
      task_id: `anno-page-${index}`,
      item_id: `anno-item-${index}`,
      reason: `需要复核 ${index}`,
    }));
    const queueRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/annotation-candidates')) {
        return jsonResponse([]);
      }
      if (url.includes('/annotation-queue')) {
        const parsed = new URL(url, 'http://localhost');
        queueRequests.push(url);
        if (!parsed.searchParams.has('page')) {
          return jsonResponse(manyAnnotationTasks);
        }
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 8);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          items: manyAnnotationTasks.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyAnnotationTasks.length, total_pages: Math.ceil(manyAnnotationTasks.length / pageSize) },
        });
      }
      if (url.endsWith('/tasks')) {
        return jsonResponse([demoTask]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/annotation-queue');

    expect(await screen.findByText('anno-item-0')).toBeInTheDocument();
    expect(screen.queryByText('anno-item-8')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(queueRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('anno-item-8')).toBeInTheDocument();
  });

  it('候选资产中心支持审批 Prompt/Skill 候选并创建 Workflow 草稿', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();
    expect(await screen.findByText('负责人工作量')).toBeInTheDocument();
    expect(await screen.findByText('复跑优先级')).toBeInTheDocument();
    expect(screen.getByText('candidate-ready')).toBeInTheDocument();
    expect(screen.getByText(/候选草稿已发布，可以直接复跑/)).toBeInTheDocument();
    expect(screen.getByText('candidate-needs-publish')).toBeInTheDocument();
    expect(screen.getByText(/候选草稿尚未发布/)).toBeInTheDocument();
    expect(screen.getByText(/未指派：1/)).toBeInTheDocument();
    expect(screen.getAllByText(/逾期：1/).length).toBeGreaterThan(0);
    expect(screen.getByText('prompt-flow-v0')).toBeInTheDocument();
    expect(screen.getByText('prompt-flow-v1')).toBeInTheDocument();
  });

  it('候选资产中心支持批量复跑、指派、归档和逾期升级', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /批量复跑可执行候选/ }));
    expect(await screen.findByText(/批量复跑完成：1 个，跳过 1 个/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('批量指派负责人'), { target: { value: 'prompt_owner' } });
    fireEvent.change(screen.getByLabelText('负责人开放候选容量'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /指派当前列表给 prompt_owner/ }));
    expect(await screen.findByText(/候选资产已指派：1 个，容量跳过 1 个/)).toBeInTheDocument();
    const bulkAssignCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input]) => String(input).endsWith('/prompt-skill-candidates/bulk-assign'));
    expect(JSON.parse(String(bulkAssignCall?.[1]?.body ?? '{}'))).toMatchObject({
      owner: 'prompt_owner',
      max_open_per_owner: 3,
    });
    expect(screen.getAllByText(/qa_owner/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /归档终态候选/ }));
    expect(await screen.findByText(/已归档候选：1 个，跳过 0 个/)).toBeInTheDocument();
    const bulkArchiveCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input]) => String(input).endsWith('/prompt-skill-candidates/bulk-archive'));
    expect(JSON.parse(String(bulkArchiveCall?.[1]?.body ?? '{}'))).toMatchObject({
      statuses: ['rejected', 'promoted', 'retested', 'promotion_rejected'],
    });

    fireEvent.click(screen.getByRole('button', { name: /升级逾期候选/ }));
    expect(await screen.findByText(/逾期候选已升级：1 个/)).toBeInTheDocument();
    expect(screen.getAllByText(/已升级/).length).toBeGreaterThan(0);
  });

  it('候选资产中心支持候选审批、生成草稿和复跑对比', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /审批通过/ }));
    expect(await screen.findByText(/候选资产已审批/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /生成草稿/ }));
    expect(await screen.findByText(/Workflow 草稿已创建：draft-candidate-demo/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /复跑对比/ }));
    expect(await screen.findByText(/候选复跑已完成：task-candidate-demo/)).toBeInTheDocument();
    expect(screen.getByText('三方指标对比')).toBeInTheDocument();
    expect(screen.getByText('Baseline：90.0%')).toBeInTheDocument();
    expect(screen.getByText('Current：80.0%')).toBeInTheDocument();
    expect(screen.getByText('Candidate：95.0%')).toBeInTheDocument();
    expect(screen.getByText(/current_to_candidate pass_rate_delta=0.15/)).toBeInTheDocument();
    expect(screen.getByText('晋升建议')).toBeInTheDocument();
    expect(screen.getByText(/建议晋升：候选版本已达到质量门槛/)).toBeInTheDocument();
    expect(screen.getByText(/创建 Workflow 晋升审批/)).toBeInTheDocument();
  });

  it('候选资产中心支持晋升审批、Baseline 应用、影响分析和回滚', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /审批通过/ }));
    expect(await screen.findByText(/候选资产已审批/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /生成草稿/ }));
    expect(await screen.findByText(/Workflow 草稿已创建：draft-candidate-demo/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /复跑对比/ }));
    expect(await screen.findByText(/候选复跑已完成：task-candidate-demo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /创建 Workflow 晋升审批/ }));
    expect(await screen.findByText(/晋升审批已创建：promotion-review-demo/)).toBeInTheDocument();
    expect(screen.getByText('Workflow 晋升审批')).toBeInTheDocument();
    expect(screen.getByText(/候选版本：wf-demo:v2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /通过晋升/ }));
    expect(await screen.findByText(/晋升审批已通过：promotion-review-demo/)).toBeInTheDocument();
    expect(screen.getByText('Baseline 替换建议')).toBeInTheDocument();
    expect(screen.getByText(/建议 baseline：exp-candidate-demo/)).toBeInTheDocument();
    expect(screen.getByText('CI Gate 发布记录')).toBeInTheDocument();
    expect(screen.getByText(/ready_to_release/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /应用 baseline/ }));
    expect(await screen.findByText(/Baseline 已应用：exp-candidate-demo/)).toBeInTheDocument();
    expect(screen.getByText(/当前 baseline：exp-candidate-demo/)).toBeInTheDocument();
    expect(screen.getByText('Baseline 变更提醒')).toBeInTheDocument();
    expect(screen.getByText(/Baseline 已从 exp-baseline 切换到 exp-candidate-demo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确认已读/ }));
    expect(await screen.findByText(/Baseline 提醒已确认：qa_owner/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /查看影响/ }));
    expect(await screen.findByText(/影响任务：1/)).toBeInTheDocument();
    expect(screen.getByText(/pass_rate_delta=0.05/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /回滚 baseline/ }));
    expect(await screen.findByText(/Baseline 已回滚：exp-baseline/)).toBeInTheDocument();
    expect(screen.getAllByText(/回滚门禁：passed/).length).toBeGreaterThan(0);
  });

  it('候选资产中心支持批量审批当前列表', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /批量审批当前列表/ }));
    expect(await screen.findByText(/批量审批完成：1 个/)).toBeInTheDocument();
    expect(screen.getByText('已审批')).toBeInTheDocument();
  });

  it('候选资产中心列表使用服务端分页', async () => {
    const manyCandidates = Array.from({ length: 12 }, (_, index) => ({
      ...demoPromptSkillCandidate,
      candidate_id: `candidate-page-${String(index).padStart(2, '0')}`,
      status: 'candidate',
    }));
    const candidateRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/prompt-skill-candidates/workload')) {
        return jsonResponse({ summary: { total_candidates: 12, total_open: 12, total_overdue: 0, escalated: 0 }, owners: [] });
      }
      if (url.includes('/prompt-skill-candidates/retest-plan')) {
        return jsonResponse({
          summary: { total_candidates: 0, ready_for_retest: 0, needs_publish: 0, needs_draft: 0, already_retested: 0, overdue: 0, escalated: 0 },
          items: [],
        });
      }
      if (url.includes('/baseline-change-notifications')) {
        return jsonResponse([]);
      }
      if (url.includes('/prompt-skill-candidates')) {
        const parsed = new URL(url, 'http://localhost');
        candidateRequests.push(url);
        if (!parsed.searchParams.has('page')) {
          return jsonResponse(manyCandidates);
        }
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 8);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          items: manyCandidates.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyCandidates.length, total_pages: Math.ceil(manyCandidates.length / pageSize) },
        });
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('candidate-page-00')).toBeInTheDocument();
    expect(screen.queryByText('candidate-page-08')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(candidateRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('candidate-page-08')).toBeInTheDocument();
  });

  it('Judge 审计创建按钮打开审计表单', async () => {
    await renderWorkbench('/judge');

    fireEvent.click(screen.getByRole('button', { name: /创建审计/ }));

    expect(await screen.findByText('创建 Judge 审计')).toBeInTheDocument();
  });

  it('Judge 审计支持打开多 Judge 一致性弹窗并展示结果', async () => {
    await renderWorkbench('/judge');

    fireEvent.click(screen.getByRole('button', { name: /多 Judge 一致性/ }));

    expect((await screen.findAllByText('多 Judge 一致性')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /开始一致性分析/ }));
    expect(await screen.findByText('judge-a|judge-b')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('Judge 审计展示偏差趋势', async () => {
    await renderWorkbench('/judge');

    expect(await screen.findByText('Judge 偏差趋势')).toBeInTheDocument();
    expect(screen.getByText('低一致性 Profile')).toBeInTheDocument();
    expect(screen.getByText('judge-demo')).toBeInTheDocument();
    expect(screen.getByText('一致性偏低。')).toBeInTheDocument();
  });

  it('治理页面权限矩阵按钮打开矩阵弹窗', async () => {
    await renderWorkbench('/governance');

    expect(screen.getByText('生产适配边界已移至文档')).toBeInTheDocument();
    expect(screen.queryByText('schema 已准备')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /查看权限矩阵/ }));

    expect(await screen.findByText('RBAC 权限矩阵')).toBeInTheDocument();
  });
});
