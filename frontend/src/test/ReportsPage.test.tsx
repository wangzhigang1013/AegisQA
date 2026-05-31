import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  demoBadcase,
  demoScoreAnalytics,
  demoTask,
  findComboboxByLabel,
  installDefaultWorkbenchMocks,
  jsonResponse,
  renderWorkbench,
} from './workbenchTestHarness';

describe('报告中心', () => {
  installDefaultWorkbenchMocks();

  it('报告中心围绕任务展示报告、质量决策和导出入口', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();
    expect((await screen.findAllByText('RAG 任务')).length).toBeGreaterThan(0);
    expect(screen.getByText('任务摘要与版本快照')).toBeInTheDocument();
    expect(screen.getByText('创建前 Preflight 证据')).toBeInTheDocument();
    expect(screen.getAllByText('preflight-demo').length).toBeGreaterThan(0);
    expect(screen.getByText('Step 分布与耗时')).toBeInTheDocument();
    expect(screen.getByText('分层分析')).toBeInTheDocument();
    expect(screen.getByText('质量决策中心')).toBeInTheDocument();
    expect(await screen.findByText('报告导出历史')).toBeInTheDocument();
    expect(screen.getByText('audit-export-html')).toBeInTheDocument();
    expect(screen.getAllByText('html').length).toBeGreaterThan(0);
    expect(screen.getAllByText('preflight-demo').length).toBeGreaterThan(0);
    expect(findComboboxByLabel('报告导出角色')).toBeInTheDocument();
    expect(screen.getByText('评测结论')).toBeInTheDocument();
    expect(screen.getByText('能否发布')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /生成修复任务/ })).toBeInTheDocument();
    expect(screen.getByText('根因诊断')).toBeInTheDocument();
    expect(screen.getByText('主要根因')).toBeInTheDocument();
    expect(screen.getAllByText('弱分层风险').length).toBeGreaterThan(0);
    expect(screen.getByText('数据质量')).toBeInTheDocument();
    expect(screen.getByText('将 Badcase 加入人工审核队列')).toBeInTheDocument();
    expect(screen.getByText('scene=payment')).toBeInTheDocument();
    expect(screen.getByText('低通过率分组加入 Annotation')).toBeInTheDocument();
    expect(screen.getAllByText('answer').length).toBeGreaterThan(0);
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('报告中心支持诊断动作、修复任务和分层门禁', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('根因诊断')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '加入人工审核' }));
    expect(await screen.findByText(/诊断动作完成：已创建 1 条人工审核任务/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /生成修复任务/ }));
    expect(await screen.findByText(/已生成 1 个修复任务/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成分层门禁' }));
    expect(await screen.findByText(/CI Gate 即时评估完成：blocking/)).toBeInTheDocument();
  });

  it('报告中心支持任务报告 HTML/CSV/JSON 导出', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /导出 HTML/ }));
    expect(await screen.findByText(/报告导出成功：RAG_任务.html 已开始下载/)).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/tasks/task-demo/report/export?file_format=html'), expect.anything());
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/audit-events?action=task.report.export&target=task-demo'), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /导出 CSV/ }));
    expect(await screen.findByText(/报告导出成功：RAG_任务.csv 已开始下载/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/tasks/task-demo/report/export?file_format=csv'), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /导出 JSON/ }));
    expect(await screen.findByText(/报告导出成功：RAG_任务.json 已开始下载/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/tasks/task-demo/report/export?file_format=json'), expect.anything());
  });

  it('报告中心支持导出审批生命周期', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();

    fireEvent.mouseDown(findComboboxByLabel('报告导出角色'));
    fireEvent.click(await screen.findByText('Viewer（只读）'));
    expect(await screen.findByText(/当前角色只有报告查看权限，不能导出或外发报告/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导出 HTML/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /申请 HTML 导出审批/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Admin 拒绝/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Admin 拒绝/ }));
    expect(await screen.findByText(/导出审批已拒绝：rex-export-demo/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/report-export-requests/rex-export-demo/reject'), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /申请 HTML 导出审批/ }));
    expect(await screen.findByText(/导出审批已提交：rex-export-demo/)).toBeInTheDocument();
    expect(screen.getByText('导出审批请求')).toBeInTheDocument();
    expect(screen.getByText('rex-export-demo')).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/tasks/task-demo/report/export-requests'), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /Admin 审批/ }));
    expect(await screen.findByText(/导出审批已通过：rex-export-demo/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /导出 HTML/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /导出 HTML/ }));
    expect(await screen.findByText(/报告导出成功：RAG_任务.html 已开始下载/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/tasks/task-demo/report/export?file_format=html&role=Viewer&approval_request_id=rex-export-demo'),
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: /撤销申请/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /撤销申请/ }));
    expect(await screen.findByText(/导出审批已撤销：rex-export-demo/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/report-export-requests/rex-export-demo/revoke'), expect.anything());
  });

  it('报告中心支持 Badcase 操作并跳转 Trace Flow', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /忽略/ }));
    expect(await screen.findByText(/Badcase 已忽略/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重开/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /加入审阅队列/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看参数治理' }));
    expect(await screen.findByText('Trace Flow')).toBeInTheDocument();
    expect(await screen.findByText('问答回归集')).toBeInTheDocument();
  });

  it('报告中心 Badcase 明细使用服务端分页，导出不受页面分页影响', async () => {
    const manyBadcases = Array.from({ length: 12 }, (_, index) => ({
      ...demoBadcase,
      badcase_id: `badcase-page-${index}`,
      item_id: `badcase-item-${index}`,
      reason: `judge_label=fail-${index}`,
    }));
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const reportRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/tasks/task-demo/report') && !url.includes('/export')) {
        reportRequests.push(url);
        const parsed = new URL(url, 'http://localhost');
        const page = Number(parsed.searchParams.get('badcase_page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('badcase_page_size') ?? 12);
        const start = (page - 1) * pageSize;
        const pageBadcases = manyBadcases.slice(start, start + pageSize);
        return jsonResponse({
          task: { ...demoTask, status: 'completed', pass_rate: 0.2, badcase_count: manyBadcases.length },
          task_summary: { task_id: 'task-demo', task_name: 'RAG 任务', run_id: 'run-demo', status: 'completed', sample_count: 12 },
          version_snapshot: { dataset: {}, workflow: {}, execution_config: {} },
          report: { run_id: 'run-demo', pass_rate: 0.2, error_rate: 0, p95_latency_ms: 12, metrics: {}, badcases: pageBadcases },
          badcases: pageBadcases,
          badcase_pagination: { page, page_size: pageSize, total_items: manyBadcases.length, total_pages: Math.ceil(manyBadcases.length / pageSize) },
          export_links: { html: '', csv: '', json: '' },
        });
      }
      if (url.includes('/tasks/task-demo/report/export?file_format=json')) {
        return jsonResponse({ task_id: 'task-demo', file_format: 'json', content: { badcases: manyBadcases, badcase_pagination: { total_items: manyBadcases.length } } });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/reports?task_id=task-demo');

    expect(await screen.findByText('badcase-item-0')).toBeInTheDocument();
    expect(screen.getByText('badcase-item-4')).toBeInTheDocument();
    expect(screen.queryByText('badcase-item-5')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(reportRequests.some((request) => request.includes('badcase_page=2') && request.includes('badcase_page_size=5'))).toBe(true);
    });
    expect(await screen.findByText('badcase-item-5')).toBeInTheDocument();
  });

  it('报告中心展示 Score Analytics、成本预算和红队扫描入口', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('跨任务 Score Analytics')).toBeInTheDocument();
    expect(screen.getByText('成本预算')).toBeInTheDocument();
    expect(screen.getAllByText('退化任务').length).toBeGreaterThan(0);
    expect(screen.getByText(/估算成本已接近任务预算/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /运行红队扫描/ }));

    expect(await screen.findByText('prompt_injection')).toBeInTheDocument();
    expect(screen.getByText('pii_leakage')).toBeInTheDocument();
    expect(screen.getByText('添加 Prompt Injection 断言')).toBeInTheDocument();
  });

  it('报告中心深链任务使用单任务接口而不是全量任务列表', async () => {
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const taskRequests: string[] = [];
    const reportRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      const parsed = new URL(url, 'http://localhost');
      if (parsed.pathname.endsWith('/tasks') && init?.method !== 'POST') {
        taskRequests.push(url);
        return jsonResponse({
          items: [{ ...demoTask, task_id: 'task-other', name: '其他任务' }],
          pagination: { page: 1, page_size: 20, total_items: 21, total_pages: 2 },
        });
      }
      if (parsed.pathname.endsWith('/tasks/task-demo')) {
        taskRequests.push(url);
        return jsonResponse(demoTask);
      }
      if (parsed.pathname.endsWith('/tasks/task-other/report')) {
        reportRequests.push(url);
        return jsonResponse({});
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/reports?task_id=task-demo');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();
    expect((await screen.findAllByText('RAG 任务')).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(taskRequests.some((request) => request.includes('/tasks?page=1') && request.includes('page_size=20'))).toBe(true);
      expect(taskRequests.some((request) => request.includes('/tasks/task-demo'))).toBe(true);
    });
    expect(reportRequests).toEqual([]);
  });

  it('报告中心任务选择器支持远程搜索历史任务', async () => {
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const taskSearches: Array<{ q: string | null; page: string | null; pageSize: string | null }> = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      const parsed = new URL(url, 'http://localhost');
      if (parsed.pathname.endsWith('/tasks') && init?.method !== 'POST') {
        const q = parsed.searchParams.get('q');
        taskSearches.push({ q, page: parsed.searchParams.get('page'), pageSize: parsed.searchParams.get('page_size') });
        return jsonResponse({
          items: q
            ? [{ ...demoTask, task_id: 'task-history', name: '历史任务', status: 'completed' }]
            : [demoTask],
          pagination: { page: 1, page_size: 20, total_items: 1, total_pages: 1 },
        });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();
    fireEvent.change(findComboboxByLabel('选择报告任务'), { target: { value: '历史任务' } });

    await waitFor(() => {
      expect(taskSearches).toContainEqual({ q: '历史任务', page: '1', pageSize: '20' });
    });
  });

  it('报告中心 Score Analytics 使用当前任务作用域和服务端分页', async () => {
    await renderWorkbench('/reports?task_id=task-demo');

    await waitFor(() => {
      const requests = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
      expect(
        requests.some(
          (request) =>
            request.includes('/score-analytics') &&
            request.includes('dataset_id=dataset-demo') &&
            request.includes('workflow_id=wf-demo') &&
            request.includes('page=1') &&
            request.includes('page_size=4'),
        ),
      ).toBe(true);
    });
  });

});
