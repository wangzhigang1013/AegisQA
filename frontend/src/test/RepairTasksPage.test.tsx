import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  demoRepairTask,
  demoTask,
  findComboboxByLabel,
  installDefaultWorkbenchMocks,
  jsonResponse,
  renderWorkbench,
} from './workbenchTestHarness';

describe('修复任务工作台', () => {
  installDefaultWorkbenchMocks();

  it('修复任务工作台支持查看证据、领取和完成', async () => {
    await renderWorkbench('/repair-tasks');

    expect(screen.getByRole('link', { name: /修复任务/ })).toBeInTheDocument();
    expect(await screen.findByText('修复任务工作台')).toBeInTheDocument();
    expect(screen.getByText('[warning] 复盘低通过率分层')).toBeInTheDocument();
    expect(screen.getByText('scene=payment 通过率 40%，Badcase 12 条。')).toBeInTheDocument();
    expect(screen.getByText('task-demo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /查看报告/ })).toHaveAttribute('href', '/reports?task_id=task-demo');

    fireEvent.click(screen.getByRole('button', { name: /领取/ }));
    expect(await screen.findByText(/修复任务已领取：qa_owner/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /完成/ }));
    expect(await screen.findByText('完成修复任务')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('说明本次修复做了什么、如何验证'), { target: { value: '已补充 Golden 并调整 Prompt。' } });
    fireEvent.click(screen.getByRole('button', { name: /确认完成/ }));
    expect(await screen.findByText(/修复任务已完成/)).toBeInTheDocument();
  });

  it('修复任务工作台列表使用服务端分页和状态筛选', async () => {
    const manyRepairTasks = Array.from({ length: 12 }, (_, index) => ({
      ...demoRepairTask,
      repair_task_id: `repair-page-${String(index).padStart(2, '0')}`,
      title: `修复任务 ${index}`,
      status: index % 3 === 0 ? 'resolved' : 'open',
    }));
    const repairRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/tasks')) {
        return jsonResponse([demoTask]);
      }
      if (url.includes('/repair-tasks') && !url.includes('/repair-tasks/')) {
        const parsed = new URL(url, 'http://localhost');
        repairRequests.push(url);
        const status = parsed.searchParams.get('status');
        const filtered = status ? manyRepairTasks.filter((item) => item.status === status) : manyRepairTasks;
        if (!parsed.searchParams.has('page')) {
          return jsonResponse(filtered);
        }
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 8);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          items: filtered.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: filtered.length, total_pages: Math.ceil(filtered.length / pageSize) },
        });
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/repair-tasks');

    expect(await screen.findByText('修复任务 0')).toBeInTheDocument();
    expect(screen.queryByText('修复任务 8')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(repairRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('修复任务 8')).toBeInTheDocument();

    fireEvent.mouseDown(findComboboxByLabel('修复任务状态筛选'));
    const resolvedOptions = await screen.findAllByText('已完成');
    fireEvent.click(resolvedOptions[resolvedOptions.length - 1]);
    await waitFor(() => {
      expect(repairRequests.some((request) => request.includes('status=resolved') && request.includes('page=1'))).toBe(true);
    });
  });

  it('修复任务工作台支持发起人工审核和 CI Gate 复测动作', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /发起人工审核/ }));
    expect((await screen.findAllByText(/已创建 2 个审核样本/)).length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getByRole('button', { name: /CI Gate 复测/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /CI Gate 复测/ }));
    expect((await screen.findAllByText(/CI Gate 复测结果：blocked/)).length).toBeGreaterThan(0);
    expect(screen.getByText('seed_annotation_queue')).toBeInTheDocument();
    expect(screen.getByText('evaluate_ci_gate')).toBeInTheDocument();
  });

  it('修复任务工作台支持复跑并展示 Attempt 对比结果', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /复跑对比/ }));

    expect((await screen.findAllByText(/复跑完成，质量状态 unchanged/)).length).toBeGreaterThan(0);
    expect(screen.getByText('retest_and_compare')).toBeInTheDocument();
  });

  it('修复任务工作台支持生成并展示上下文修复建议', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /生成建议/ }));

    expect(await screen.findByText(/已生成 1 条修复建议/)).toBeInTheDocument();
    expect(screen.getByText('低通过率分层修复建议')).toBeInTheDocument();
    expect(screen.getByText('generate_remediation_plan')).toBeInTheDocument();
  });

  it('修复任务工作台支持把建议拆成可追踪子任务', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /拆分子任务/ }));

    expect((await screen.findAllByText(/已创建 2 个后续修复任务/)).length).toBeGreaterThan(0);
    expect(screen.getByText('create_followup_repair_tasks')).toBeInTheDocument();
    expect(screen.getByText('低通过率分层修复建议')).toBeInTheDocument();
    expect(screen.getByText('确认修复是否进入当前 Attempt')).toBeInTheDocument();
    expect(screen.getByText('seed_annotation_queue')).toBeInTheDocument();
    expect(screen.getByText('plan_workflow_parameter_changes')).toBeInTheDocument();
  });

  it('修复任务工作台支持查看修复树进度', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /查看进度/ }));

    expect(await screen.findByText('修复树进度')).toBeInTheDocument();
    expect(await screen.findByText(/已完成 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText('低通过率分层修复建议')).toBeInTheDocument();
    expect(screen.getAllByText('确认修复是否进入当前 Attempt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('plan_workflow_parameter_changes').length).toBeGreaterThan(0);
  });

  it('修复任务工作台支持指派负责人并在修复树提示逾期', async () => {
    await renderWorkbench('/repair-tasks');

    await screen.findByText('[warning] 复盘低通过率分层');
    fireEvent.click(await screen.findByRole('button', { name: /指派修复任务/ }));
    expect(await screen.findByText('指派修复任务')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('例如：dataset_owner'), { target: { value: 'dataset_owner' } });
    fireEvent.change(screen.getByPlaceholderText('例如：2026-06-01T00:00:00+00:00'), { target: { value: '2000-01-01T00:00:00+00:00' } });
    fireEvent.click(screen.getByRole('button', { name: /确认指派/ }));

    expect(await screen.findByText(/修复任务已指派给：dataset_owner/)).toBeInTheDocument();
    expect(screen.getAllByText('dataset_owner').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /查看进度/ }));
    expect(await screen.findByText(/逾期子任务 1 个/)).toBeInTheDocument();
  });

  it('修复任务工作台支持生成 Dataset 字段修复计划', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /字段修复计划/ }));

    expect(await screen.findByText(/已生成 1 条字段修复建议/)).toBeInTheDocument();
    expect(screen.getByText('fix_dataset_fields')).toBeInTheDocument();
    expect(screen.getByText(/reference/)).toBeInTheDocument();
    expect(screen.getByText(/这是 Workflow 必需字段/)).toBeInTheDocument();
  });

  it('修复任务工作台支持生成 Workflow 参数 diff 和回滚建议', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /参数 diff\/回滚/ }));

    expect(await screen.findByText(/已生成 1 条参数 diff 和回滚建议/)).toBeInTheDocument();
    expect(screen.getByText('plan_workflow_parameter_changes')).toBeInTheDocument();
    expect(screen.getByText(/answer.model/)).toBeInTheDocument();
    expect(screen.getByText(/task-quality-model/)).toBeInTheDocument();
    expect(screen.getByText(/移除覆盖或将确认后的值发布到新 Workflow 版本/)).toBeInTheDocument();
  });

  it('修复任务工作台支持生成 Prompt 和 Skill 版本对比', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /版本对比/ }));

    expect(await screen.findByText(/已生成 1 个 Prompt\/Skill 版本对比候选/)).toBeInTheDocument();
    expect(screen.getByText('compare_prompt_skill_versions')).toBeInTheDocument();
    expect(screen.getByText(/answer.prompt_version/)).toBeInTheDocument();
    expect(screen.getByText(/prompt-flow-v0/)).toBeInTheDocument();
    expect(screen.getByText(/prompt-flow-v1/)).toBeInTheDocument();
  });

  it('修复任务工作台支持把版本对比沉淀为候选配置', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /版本对比/ }));
    expect(await screen.findByText(/已生成 1 个 Prompt\/Skill 版本对比候选/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /沉淀候选/ }));

    expect((await screen.findAllByText(/已沉淀 1 个 Prompt\/Skill 候选配置/)).length).toBeGreaterThan(0);
    expect(screen.getByText('create_prompt_skill_candidate')).toBeInTheDocument();
  });

  it('修复任务工作台支持从版本差异创建 Workflow 草稿', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /版本对比/ }));
    expect(await screen.findByText(/已生成 1 个 Prompt\/Skill 版本对比候选/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /生成草稿/ }));

    expect((await screen.findAllByText(/已创建 Workflow 草稿：draft-version-diff/)).length).toBeGreaterThan(0);
    expect(screen.getByText('create_workflow_draft_from_version_diff')).toBeInTheDocument();
  });

  it('修复任务工作台沉淀候选后仍可继续生成 Workflow 草稿', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /版本对比/ }));
    expect(await screen.findByText(/已生成 1 个 Prompt\/Skill 版本对比候选/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /沉淀候选/ }));
    expect((await screen.findAllByText(/已沉淀 1 个 Prompt\/Skill 候选配置/)).length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByRole('button', { name: /生成草稿/ }));

    expect((await screen.findAllByText(/已创建 Workflow 草稿：draft-version-diff/)).length).toBeGreaterThan(0);
  });

});
