// @ts-nocheck
import { Download as DownloadOutlined, FileText as FileTextOutlined } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Input, List, Row, Select, Space, Table, Tag, Tooltip, Typography } from '../components/AntdShims';
import { useEffect, useMemo, useState, type Key } from 'react';
import {
  downloadReportExport, downloadBlob, formatAuditTime, formatTokenCount,
  releaseRecordStatusColor, ensureBadcaseId, asRecord, causeLabel,
  severityColor, priorityColor, actionLabel, publishDecisionLabel,
  formatDiagnosticActionNotice, selectRepairTaskForAction,
} from './report/reportHelpers';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';

import { runWorkbenchAction } from '../actions/actionRouter';
import { api, formatApiError } from '../api/client';
import { LazyECharts } from '../components/LazyECharts';
import { ActionToolbar, DataTableShell, PageSection } from '../components/LayoutPrimitives';
import { MetricTile } from '../components/MetricTile';
import { PageHeader } from '../components/PageHeader';
import type { AuditEvent, RepairTaskRecord, ReportExportRequest, TaskRecord, WorkbenchAction } from '../types';
import { BadcaseTable } from './report/BadcaseTable';
import { ReportSegmentAnalysis } from './report/ReportSegmentAnalysis';
import { ReportSummary } from './report/ReportSummary';

type ReportInlineExportFormat = 'html' | 'csv' | 'json';
type ReportExportFormat = ReportInlineExportFormat | 'offline_zip';
type ReportExportRole = 'Evaluator' | 'Reviewer' | 'Admin' | 'Viewer';

const reportExportMimeTypes: Record<string, string> = {
  html: 'text/html;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

const reportExportRoles: { value: ReportExportRole; label: string; canExport: boolean }[] = [
  { value: 'Evaluator', label: 'Evaluator（评测负责人）', canExport: true },
  { value: 'Reviewer', label: 'Reviewer（审核员）', canExport: true },
  { value: 'Admin', label: 'Admin（管理员）', canExport: true },
  { value: 'Viewer', label: 'Viewer（只读）', canExport: false },
];

export function ReportsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const taskIdFromUrl = searchParams.get('task_id');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [exportRole, setExportRole] = useState<ReportExportRole>('Evaluator');
  const [pendingDiagnosticAction, setPendingDiagnosticAction] = useState<string | null>(null);
  const [selectedBadcaseKeys, setSelectedBadcaseKeys] = useState<Key[]>([]);
  const [badcasePage, setBadcasePage] = useState(1);
  const [stepPage, setStepPage] = useState(1);
  const [stepSearch, setStepSearch] = useState('');
  const [segmentPage, setSegmentPage] = useState(1);
  const [segmentSearch, setSegmentSearch] = useState('');
  const [rootCausePage, setRootCausePage] = useState(1);
  const [rootCauseSearch, setRootCauseSearch] = useState('');
  const [diagnosticStepPage, setDiagnosticStepPage] = useState(1);
  const [scorePage, setScorePage] = useState(1);
  const badcasePageSize = 5;
  const stepPageSize = 3;
  const segmentPageSize = 6;
  const rootCausePageSize = 4;
  const diagnosticStepPageSize = 4;
  const scorePageSize = 4;
  const reportTaskPageSize = 20;
  const normalizedTaskSearch = taskSearch.trim();
  const tasksQuery = useQuery({
    queryKey: ['tasks', 'report-picker', normalizedTaskSearch, 1, reportTaskPageSize],
    queryFn: () => api.tasksPage({ q: normalizedTaskSearch || undefined, page: 1, pageSize: reportTaskPageSize }),
  });
  const listedTasks = tasksQuery.data?.items ?? [];
  const selectedTaskFromList = listedTasks.find((task) => task.task_id === selectedTaskId) ?? null;
  const selectedTaskQuery = useQuery({
    queryKey: ['task', selectedTaskId],
    queryFn: () => api.task(selectedTaskId ?? ''),
    enabled: Boolean(selectedTaskId && !selectedTaskFromList),
  });
  const taskOptions = useMemo(() => {
    if (selectedTaskQuery.data && !listedTasks.some((task) => task.task_id === selectedTaskQuery.data?.task_id)) {
      return [selectedTaskQuery.data, ...listedTasks];
    }
    return listedTasks;
  }, [listedTasks, selectedTaskQuery.data]);
  const selectedTask = selectedTaskFromList ?? selectedTaskQuery.data ?? (taskIdFromUrl ? null : listedTasks[0] ?? null);
  const scoreAnalyticsQuery = useQuery({
    queryKey: ['score-analytics', selectedTask?.dataset_id, selectedTask?.workflow_id, scorePage, scorePageSize],
    queryFn: () =>
      api.scoreAnalytics({
        dataset_id: selectedTask?.dataset_id,
        workflow_id: selectedTask?.workflow_id,
        page: scorePage,
        pageSize: scorePageSize,
      }),
    enabled: Boolean(selectedTask?.task_id),
  });
  const reportQuery = useQuery({
    queryKey: [
      'task-report',
      selectedTask?.task_id,
      badcasePage,
      badcasePageSize,
      stepPage,
      stepPageSize,
      stepSearch.trim(),
      segmentPage,
      segmentPageSize,
      segmentSearch.trim(),
      rootCausePage,
      rootCausePageSize,
      rootCauseSearch.trim(),
      diagnosticStepPage,
      diagnosticStepPageSize,
    ],
    queryFn: () =>
      api.taskReport(selectedTask?.task_id ?? '', {
        badcasePage,
        badcasePageSize,
        stepPage,
        stepPageSize,
        stepQuery: stepSearch.trim() || undefined,
        segmentPage,
        segmentPageSize,
        segmentQuery: segmentSearch.trim() || undefined,
        rootCausePage,
        rootCausePageSize,
        rootCauseQuery: rootCauseSearch.trim() || undefined,
        diagnosticStepPage,
        diagnosticStepPageSize,
      }),
    enabled: Boolean(selectedTask?.task_id),
  });
  const exportHistoryQuery = useQuery({
    queryKey: ['audit-events', 'task.report.export', selectedTask?.task_id],
    queryFn: () => api.auditEvents({ action: 'task.report.export', target: selectedTask?.task_id ?? '' }),
    enabled: Boolean(selectedTask?.task_id),
  });
  const exportRequestsQuery = useQuery({
    queryKey: ['report-export-requests', selectedTask?.task_id],
    queryFn: () => api.reportExportRequests({ task_id: selectedTask?.task_id ?? '' }),
    enabled: Boolean(selectedTask?.task_id),
  });
  const releaseContext = reportQuery.data?.release_context;

  useEffect(() => {
    if (taskIdFromUrl && taskIdFromUrl !== selectedTaskId) {
      setSelectedTaskId(taskIdFromUrl);
      return;
    }
    if (!selectedTaskId && listedTasks[0]) {
      setSelectedTaskId(listedTasks[0].task_id);
    }
  }, [taskIdFromUrl, listedTasks, selectedTaskId]);

  function changeSelectedTask(nextTaskId: string) {
    setSelectedTaskId(nextTaskId);
    setTaskSearch('');
    setBadcasePage(1);
    setStepSearch('');
    setStepPage(1);
    setSegmentSearch('');
    setSegmentPage(1);
    setRootCauseSearch('');
    setRootCausePage(1);
    setDiagnosticStepPage(1);
    setScorePage(1);
    setSelectedBadcaseKeys([]);
    setSearchParams(nextTaskId ? { task_id: nextTaskId } : {});
  }

  useEffect(() => {
    setScorePage(1);
  }, [selectedTask?.dataset_id, selectedTask?.workflow_id]);

  function upsertReportExportRequest(request: ReportExportRequest) {
    queryClient.setQueryData<ReportExportRequest[]>(['report-export-requests', request.task_id], (current = []) =>
      current.some((item) => item.request_id === request.request_id)
        ? current.map((item) => (item.request_id === request.request_id ? request : item))
        : [request, ...current],
    );
  }

  function approvedExportRequestFor(format: ReportExportFormat): ReportExportRequest | undefined {
    return (exportRequestsQuery.data ?? []).find(
      (request) => request.status === 'approved' && request.file_format === format && request.requester_role === exportRole,
    );
  }

  function canExportFormat(format: ReportExportFormat): boolean {
    return canExportReport || Boolean(approvedExportRequestFor(format));
  }

  const exportMutation = useMutation({
    mutationFn: async (format: ReportInlineExportFormat) => {
      if (!selectedTask) {
        throw new Error('请先选择任务，再导出报告。');
      }
      const approvalRequest = approvedExportRequestFor(format);
      if (!canExportReport && !approvalRequest) {
        throw new Error('当前角色需要先获得报告导出审批。');
      }
      const exported = await api.exportTaskReport(selectedTask.task_id, format, exportRole, approvalRequest?.request_id);
      return { exported, task: selectedTask };
    },
    onSuccess: async ({ exported, task }) => {
      const filename = downloadReportExport(exported, task);
      setNotice(`报告导出成功：${filename} 已开始下载。`);
      await queryClient.invalidateQueries({ queryKey: ['audit-events', 'task.report.export', task.task_id] });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : '报告导出失败'),
  });

  const offlinePackageMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTask) {
        throw new Error('请先选择任务，再导出离线包。');
      }
      const approvalRequest = approvedExportRequestFor('offline_zip');
      if (!canExportReport && !approvalRequest) {
        throw new Error('当前角色需要先获得离线包导出审批。');
      }
      const download = await api.exportTaskReportOfflinePackage(selectedTask.task_id, exportRole, approvalRequest?.request_id);
      return { download, task: selectedTask };
    },
    onSuccess: async ({ download, task }) => {
      const filename = downloadBlob(download.blob, download.filename ?? `${safeReportFileName(task.name || task.task_id)}_offline_audit.zip`);
      setNotice(`离线包导出成功：${filename} 已开始下载。`);
      await queryClient.invalidateQueries({ queryKey: ['audit-events', 'task.report.export', task.task_id] });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : '离线包导出失败'),
  });

  const exportRequestMutation = useMutation({
    mutationFn: (format: ReportExportFormat = 'html') => {
      if (!selectedTask) {
        throw new Error('请先选择任务，再申请导出审批。');
      }
      return api.createReportExportRequest(selectedTask.task_id, {
        file_format: format,
        requester_role: exportRole,
        reason: format === 'offline_zip' ? '只读角色需要导出离线审计包用于外部归档。' : '只读角色需要导出 HTML 任务报告用于业务复盘。',
      });
    },
    onSuccess: async (request) => {
      setNotice(`导出审批已提交：${request.request_id}`);
      upsertReportExportRequest(request);
      await queryClient.invalidateQueries({ queryKey: ['report-export-requests', request.task_id] });
    },
    onError: (error) => setNotice(error instanceof Error ? `导出审批提交失败：${error.message}` : '导出审批提交失败'),
  });

  const approveExportRequestMutation = useMutation({
    mutationFn: (requestId: string) => api.approveReportExportRequest(requestId, { approver_role: 'Admin', note: '允许本次离线复盘。' }),
    onSuccess: async (request) => {
      setNotice(`导出审批已通过：${request.request_id}`);
      await queryClient.invalidateQueries({ queryKey: ['report-export-requests', request.task_id] });
      upsertReportExportRequest(request);
    },
    onError: (error) => setNotice(error instanceof Error ? `导出审批失败：${error.message}` : '导出审批失败'),
  });

  const rejectExportRequestMutation = useMutation({
    mutationFn: (requestId: string) => api.rejectReportExportRequest(requestId, { approver_role: 'Admin', note: 'CSV 明细包含敏感样本，暂不外发。' }),
    onSuccess: async (request) => {
      setNotice(`导出审批已拒绝：${request.request_id}`);
      await queryClient.invalidateQueries({ queryKey: ['report-export-requests', request.task_id] });
      upsertReportExportRequest(request);
    },
    onError: (error) => setNotice(error instanceof Error ? `导出审批拒绝失败：${error.message}` : '导出审批拒绝失败'),
  });

  const revokeExportRequestMutation = useMutation({
    mutationFn: (requestId: string) => api.revokeReportExportRequest(requestId, { requester_role: exportRole, reason: '已改用在线报告。' }),
    onSuccess: async (request) => {
      setNotice(`导出审批已撤销：${request.request_id}`);
      await queryClient.invalidateQueries({ queryKey: ['report-export-requests', request.task_id] });
      upsertReportExportRequest(request);
    },
    onError: (error) => setNotice(error instanceof Error ? `导出审批撤销失败：${error.message}` : '导出审批撤销失败'),
  });

  const redTeamScanMutation = useMutation({
    mutationFn: () => {
      if (!selectedTask) {
        throw new Error('请先选择任务，再运行红队扫描。');
      }
      return api.redTeamScan({ task_id: selectedTask.task_id });
    },
    onSuccess: (scan) => setNotice(`红队扫描完成：发现 ${scan.summary.risk_count} 个风险。`),
    onError: (error) => setNotice(error instanceof Error ? `红队扫描失败：${error.message}` : '红队扫描失败'),
  });

  const badcaseActionMutation = useMutation({
    mutationFn: async ({ action, badcase }: { action: 'golden' | 'ignore' | 'reopen' | 'annotation'; badcase: Record<string, unknown> }) => {
      if (action === 'annotation') {
        if (!task?.run_id) throw new Error('缺少 Run 信息，无法加入审阅队列。');
        return api.seedAnnotationQueue({ run_id: task.run_id, strategy: 'badcase', limit: 1 });
      }
      if (action === 'reopen') {
        if (!badcase.badcase_id) throw new Error('只有已持久化 Badcase 可以重开。');
        return api.reopenBadcase(String(badcase.badcase_id));
      }
      const badcaseId = await ensureBadcaseId(badcase, task);
      return api.correctBadcase(badcaseId, {
        human_label: action === 'ignore' ? 'ignored' : 'fail',
        problem_type: String(badcase.problem_type ?? 'manual_review'),
        note: action === 'ignore' ? '从任务报告标记忽略。' : '从任务报告加入 Golden 候选。',
        add_to_golden: action === 'golden',
        ignore: action === 'ignore',
      });
    },
    onSuccess: async (_, variables) => {
      const messageMap = {
        golden: 'Badcase 已加入 Golden 候选。',
        ignore: 'Badcase 已忽略。',
        reopen: 'Badcase 已重开。',
        annotation: 'Badcase 已加入 Annotation Queue。',
      };
      setNotice(messageMap[variables.action]);
      await queryClient.invalidateQueries({ queryKey: ['task-report', selectedTask?.task_id] });
    },
    onError: (error) => setNotice(error instanceof Error ? `Badcase 操作失败：${error.message}` : 'Badcase 操作失败'),
  });

  const bulkGoldenMutation = useMutation({
    mutationFn: () => {
      const badcaseIds = selectedBadcaseKeys.map(String).filter((key) => key.startsWith('badcase-'));
      if (!badcaseIds.length) {
        throw new Error('请选择已经持久化的 Badcase 后再批量处理。');
      }
      return api.bulkCorrectBadcases({
        badcase_ids: badcaseIds,
        human_label: 'fail',
        problem_type: 'manual_review',
        note: '从任务报告批量加入 Golden 候选。',
        add_to_golden: true,
      });
    },
    onSuccess: async () => {
      setSelectedBadcaseKeys([]);
      setNotice('已批量加入 Golden 候选。');
      await queryClient.invalidateQueries({ queryKey: ['task-report', selectedTask?.task_id] });
    },
    onError: (error) => setNotice(error instanceof Error ? `批量处理失败：${error.message}` : '批量处理失败'),
  });

  const bulkRepairTaskMutation = useMutation({
    mutationFn: async () => {
      if (!task) {
        throw new Error('请先选择任务，再生成修复任务。');
      }
      const selectedCount = selectedBadcaseKeys.length;
      if (!selectedCount) {
        throw new Error('请选择 Badcase 后再批量生成修复任务。');
      }
      const result = await api.createRepairTasksFromDiagnostics(task.task_id);
      return { result, selectedCount };
    },
    onSuccess: async ({ result, selectedCount }) => {
      setSelectedBadcaseKeys([]);
      setNotice(`已基于当前报告诊断和 ${selectedCount} 条选中 Badcase 生成修复任务：新增 ${result.created_count} 个，复用 ${result.reused_count} 个。`);
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks', selectedTask?.task_id] });
    },
    onError: (error) => setNotice(error instanceof Error ? `批量生成修复任务失败：${error.message}` : '批量生成修复任务失败'),
  });

  const diagnosticActionMutation = useMutation({
    mutationFn: async (action: string) => {
      if (!task) {
        throw new Error('请先选择任务，再执行诊断动作。');
      }
      if (action === 'seed_annotation_queue') {
        if (!task.run_id) throw new Error('缺少 Run 信息，无法加入人工审核。');
        return { action, result: await api.seedAnnotationQueue({ run_id: task.run_id, strategy: 'badcase', limit: Math.min(Math.max(badcases.length, 1), 20) }) };
      }
      if (action === 'create_segment_ci_gate') {
        return { action, result: await api.evaluateCIGates({ task_id: task.task_id }) };
      }
      if (action === 'retry_failed_items') {
        return { action, result: await api.retryFailedTask(task.task_id) };
      }
      if (action === 'plan_workflow_parameter_changes') {
        const repairSeed = await api.createRepairTasksFromDiagnostics(task.task_id);
        const repairTask = selectRepairTaskForAction(repairSeed.repair_tasks, action);
        if (!repairTask) {
          throw new Error('未找到可承载参数变更计划的修复任务，请先点击“生成修复任务”。');
        }
        const actionResult = await api.runRepairTaskAction(repairTask.repair_task_id, { action, assignee: 'qa_owner', limit: 20 });
        return {
          action,
          result: {
            ...actionResult.result,
            repair_task_id: repairTask.repair_task_id,
            created_count: repairSeed.created_count,
            reused_count: repairSeed.reused_count,
          },
        };
      }
      throw new Error(`当前诊断动作暂不支持：${actionLabel(action)}`);
    },
    onSuccess: async ({ action, result }) => {
      setNotice(formatDiagnosticActionNotice(action, result));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['task-report', selectedTask?.task_id] }),
        queryClient.invalidateQueries({ queryKey: ['annotation-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['ci-gate-evaluations'] }),
        queryClient.invalidateQueries({ queryKey: ['repair-tasks', selectedTask?.task_id] }),
      ]);
    },
    onError: (error) => setNotice(error instanceof Error ? `诊断动作失败：${error.message}` : '诊断动作失败'),
    onSettled: () => setPendingDiagnosticAction(null),
  });

  const repairTaskMutation = useMutation({
    mutationFn: () => {
      if (!task) {
        throw new Error('请先选择任务，再生成修复任务。');
      }
      return api.createRepairTasksFromDiagnostics(task.task_id);
    },
    onSuccess: async (result) => {
      setNotice(`已生成 ${result.created_count} 个修复任务。`);
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks', selectedTask?.task_id] });
    },
    onError: (error) => setNotice(error instanceof Error ? `生成修复任务失败：${error.message}` : '生成修复任务失败'),
  });

  const report = reportQuery.data?.report;
  const task = reportQuery.data?.task ?? selectedTask;
  const badcases = reportQuery.data?.badcases ?? [];
  const stepDistribution = reportQuery.data?.step_distribution ?? [];
  const qualityDecision = reportQuery.data?.quality_decision;
  const budgetStatus = reportQuery.data?.budget_status;
  const diagnostics = reportQuery.data?.diagnostics;
  const primaryFindings = reportQuery.data?.primary_findings ?? [];
  const qualityNextActions: WorkbenchAction[] = (qualityDecision?.next_actions ?? []).map((action) => ({ ...action }));
  const recommendedActions: WorkbenchAction[] = reportQuery.data?.recommended_actions ?? qualityNextActions;
  const scoreAnalytics = scoreAnalyticsQuery.data;
  const exportHistory: AuditEvent[] = exportHistoryQuery.data ?? [];
  const exportRequests: ReportExportRequest[] = exportRequestsQuery.data ?? [];
  const canExportReport = reportExportRoles.find((item) => item.value === exportRole)?.canExport ?? false;
  const hasHtmlExportApproval = Boolean(approvedExportRequestFor('html'));
  const hasOfflinePackageApproval = Boolean(approvedExportRequestFor('offline_zip'));
  const latencyData = useMemo(() => {
    if (stepDistribution.length) {
      return Object.fromEntries(stepDistribution.map((step) => [step.step_id, step.average_latency_ms]));
    }
    const metrics = report?.metrics ?? {};
    const stepMetrics = Object.entries(metrics).filter(([key]) => key.includes('latency') || key.includes('耗时'));
    return stepMetrics.length ? Object.fromEntries(stepMetrics) : { Source: 8, Skill: report?.average_latency_ms ?? 0, Judge: report?.p95_latency_ms ?? 0 };
  }, [report, stepDistribution]);
  const chartOption = {
    tooltip: {},
    grid: { left: 36, right: 20, top: 24, bottom: 32 },
    xAxis: { type: 'category', data: Object.keys(latencyData) },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: Object.values(latencyData), itemStyle: { color: '#2563eb' } }],
  };

  function handleDiagnosticAction(action: string) {
    if (!task) {
      setNotice('请先选择任务，再执行诊断动作。');
      return;
    }
    const routeMap: Record<string, string> = {
      open_trace_flow: `/tasks/${task.task_id}/trace`,
      open_parameter_governance: `/tasks/${task.task_id}/trace?panel=parameters`,
      open_dataset_lineage: `/datasets?dataset_id=${encodeURIComponent(task.dataset_id)}&version=${task.dataset_version}`,
      fix_dataset_fields: `/datasets?dataset_id=${encodeURIComponent(task.dataset_id)}&version=${task.dataset_version}`,
      audit_judge_profile: '/judge',
    };
    if (routeMap[action]) {
      navigate(routeMap[action]);
      return;
    }
    if (action === 'review_badcases') {
      setNotice('请在下方 Badcase 表格复核样本，可加入 Golden、忽略、重开或加入审阅队列。');
      return;
    }
    setPendingDiagnosticAction(action);
    diagnosticActionMutation.mutate(action);
  }

  function handleRecommendedAction(action: WorkbenchAction) {
    if (!task) {
      setNotice('请先选择任务，再执行报告建议动作。');
      return;
    }
    runWorkbenchAction(action, {
      navigate,
      createRepairTasks: () => repairTaskMutation.mutate(),
      fallback: handleDiagnosticAction,
      notify: setNotice,
    });
  }

  return (
    <section className="page-stack">


      {notice ? <Alert type={notice.includes('失败') || notice.includes('请先') ? 'warning' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}
      {tasksQuery.isError ? (
        <Alert type="error" showIcon message="报告任务列表加载失败" description={formatApiError(tasksQuery.error)} />
      ) : null}
      {selectedTaskQuery.isError ? (
        <Alert type="error" showIcon message="报告任务详情加载失败" description={formatApiError(selectedTaskQuery.error)} />
      ) : null}
      {reportQuery.isError ? (
        <Alert type="error" showIcon message="报告加载失败" description={formatApiError(reportQuery.error)} />
      ) : null}
      {scoreAnalyticsQuery.isError ? (
        <Alert type="warning" showIcon message="Score Analytics 加载失败" description={formatApiError(scoreAnalyticsQuery.error)} />
      ) : null}
      {!canExportReport ? (
        <Alert
          type={hasHtmlExportApproval || hasOfflinePackageApproval ? 'info' : 'warning'}
          showIcon
          message={hasHtmlExportApproval || hasOfflinePackageApproval ? '当前角色已获得部分导出审批，可导出已审批格式。' : '当前角色只有报告查看权限，不能导出或外发报告。'}
          action={
            !hasHtmlExportApproval || !hasOfflinePackageApproval ? (
              <Space>
                {!hasHtmlExportApproval ? (
                  <Button size="small" loading={exportRequestMutation.isPending && exportRequestMutation.variables === 'html'} onClick={() => exportRequestMutation.mutate('html')}>
                    申请 HTML 导出审批
                  </Button>
                ) : null}
                {!hasOfflinePackageApproval ? (
                  <Button size="small" loading={exportRequestMutation.isPending && exportRequestMutation.variables === 'offline_zip'} onClick={() => exportRequestMutation.mutate('offline_zip')}>
                    申请离线包导出审批
                  </Button>
                ) : null}
              </Space>
            ) : null
          }
        />
      ) : null}

      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-2xl p-6 mb-8 mt-2 relative overflow-hidden">
        {/* 装饰性背景 */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 rounded-full blur-2xl pointer-events-none"></div>

        <div className="relative flex flex-col lg:flex-row justify-between items-center gap-6 z-10">
          <div className="flex items-center gap-5 w-full lg:w-1/3">
            <div className="p-4 bg-blue-500/20 rounded-2xl text-blue-400 shadow-inner border border-blue-500/20">
              <FileTextOutlined className="text-3xl" />
            </div>
            <div>
              <Typography.Title level={4} className="m-0 text-white font-bold tracking-wide">报告分析大屏</Typography.Title>
              <Typography.Text className="text-slate-400 text-sm">选择运行任务并查看全方位诊断</Typography.Text>
            </div>
          </div>
          
          <div className="w-full lg:w-2/3 flex flex-col lg:items-end gap-3">
            <Select
              aria-label="选择报告任务"
              placeholder="快速切换分析任务..."
              className="w-full lg:max-w-md"
              size="large"
              showSearch
              filterOption={false}
              searchValue={taskSearch}
              value={selectedTask?.task_id}
              loading={tasksQuery.isLoading || selectedTaskQuery.isFetching}
              onSearch={setTaskSearch}
              onChange={changeSelectedTask}
              options={taskOptions.map((item) => ({ value: item.task_id, label: `${item.name} - [${item.status}]` }))}
            />
            <div className="h-8 flex items-center justify-start lg:justify-end">
              {task ? (
                <div className="flex flex-wrap gap-2">
                  <span className="bg-blue-500/20 text-blue-300 border border-blue-500/20 px-3 py-1 rounded-full text-xs font-semibold tracking-wide">数据集: {task.dataset_name} v{task.dataset_version}</span>
                  <span className="bg-purple-500/20 text-purple-300 border border-purple-500/20 px-3 py-1 rounded-full text-xs font-semibold tracking-wide">工作流: {task.workflow_name}</span>
                  <span className={`${task.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20' : 'bg-orange-500/20 text-orange-300 border-orange-500/20'} border px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide`}>{task.status}</span>
                </div>
              ) : (
                <span className="text-slate-500 text-sm">暂无任务报告，请先在执行中心创建任务。</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {task ? (
        <>
          {qualityDecision ? (
            <Card className="flat-card" title="评测结论">
              <Row gutter={[16, 16]} align="middle">
                <Col xs={24} lg={6}>
                  <Typography.Text type="secondary">能否发布</Typography.Text>
                  <div className="section-actions">
                    <Tag color={qualityDecision.status === 'blocked' ? 'red' : qualityDecision.status === 'warning' ? 'orange' : 'green'}>
                      {publishDecisionLabel(qualityDecision.status)}
                    </Tag>
                  </div>
                </Col>
                <Col xs={24} lg={8}>
                  <Typography.Text type="secondary">为什么</Typography.Text>
                  <Typography.Paragraph className="paragraph-tight">
                    {primaryFindings[0]?.message ?? diagnostics?.root_causes[0]?.recommendation ?? qualityDecision.top_risks[0]?.message ?? '当前任务未发现阻断性风险。'}
                  </Typography.Paragraph>
                </Col>
                <Col xs={24} lg={6}>
                  <Typography.Text type="secondary">影响多大</Typography.Text>
                  <Space wrap className="section-actions">
                    <Tag>通过率 {Math.round(qualityDecision.risk_summary.pass_rate * 100)}%</Tag>
                    <Tag>Badcase {qualityDecision.risk_summary.badcase_count}</Tag>
                    <Tag>低分层 {qualityDecision.risk_summary.weak_segment_count}</Tag>
                  </Space>
                </Col>
                <Col xs={24} lg={4}>
                  <Button
                    type="primary"
                    block
                    loading={repairTaskMutation.isPending}
                    onClick={() => repairTaskMutation.mutate()}
                  >
                    生成诊断修复任务
                  </Button>
                </Col>
              </Row>
            </Card>
          ) : null}

          {primaryFindings.length || recommendedActions.length ? (
            <Card className="flat-card" title="优先结论与动作">
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={14}>
                  <List
                    dataSource={primaryFindings}
                    locale={{ emptyText: '当前报告没有需要优先处理的结构化结论。' }}
                    renderItem={(finding) => (
                      <List.Item>
                        <List.Item.Meta
                          title={(
                            <Space wrap>
                              <Typography.Text strong>{finding.title}</Typography.Text>
                              <Tag color={severityColor(finding.severity)}>{finding.status}</Tag>
                              <Tag>{finding.source}</Tag>
                            </Space>
                          )}
                          description={(
                            <Space direction="vertical" className="full-width-control">
                              <Typography.Text>{finding.message}</Typography.Text>
                              {finding.evidence?.length ? (
                                <Space wrap>
                                  {finding.evidence.map((item) => <Tag key={item}>{item}</Tag>)}
                                </Space>
                              ) : null}
                            </Space>
                          )}
                        />
                      </List.Item>
                    )}
                  />
                </Col>
                <Col xs={24} xl={10}>
                  <List
                    dataSource={recommendedActions}
                    locale={{ emptyText: '当前报告没有可执行的建议动作。' }}
                    renderItem={(action) => (
                      <List.Item
                        actions={[
                          <Button
                            key={action.action}
                            size="small"
                            disabled={action.enabled === false}
                            loading={repairTaskMutation.isPending && action.action === 'create_repair_tasks'}
                            onClick={() => handleRecommendedAction(action)}
                          >
                            {action.label}
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={(
                            <Space wrap>
                              <Typography.Text>{action.label}</Typography.Text>
                              {action.priority ? <Tag color={priorityColor(action.priority)}>{action.priority}</Tag> : null}
                            </Space>
                          )}
                          description={action.disabled_reason ?? action.evidence?.join('；') ?? action.target_url ?? action.action}
                        />
                      </List.Item>
                    )}
                  />
                </Col>
              </Row>
            </Card>
          ) : null}

          <ReportSummary task={task} summary={reportQuery.data?.task_summary} versionSnapshot={reportQuery.data?.version_snapshot} preflightEvidence={reportQuery.data?.preflight_evidence} />

          {releaseContext && (releaseContext.baselines.length || releaseContext.release_records.length) ? (
            <Card className="flat-card" title="Baseline 与发布记录">
              <Space direction="vertical" className="full-width-control" size="middle">
                {releaseContext.baselines.length ? (
                  <Space wrap>
                    {releaseContext.baselines.map((baseline) => (
                      <Tag key={baseline.baseline_id} color="blue">
                        当前 baseline：{baseline.current_experiment_id ?? '-'}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="secondary">当前任务还没有匹配的 baseline。</Typography.Text>
                )}
                <Table
                  size="small"
                  rowKey="record_id"
                  pagination={false}
                  dataSource={releaseContext.release_records}
                  locale={{ emptyText: '当前任务还没有匹配的 Workflow 发布记录。' }}
                  columns={[
                    { title: '发布记录', dataIndex: 'record_id', render: (value) => <code>{value}</code> },
                    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={releaseRecordStatusColor(String(value))}>{String(value)}</Tag> },
                    { title: 'Workflow', dataIndex: 'workflow_version_id', render: (value) => String(value ?? '-') },
                    { title: '门禁', render: (_, record) => `${record.ci_gate_config_ids.length} 个 / 阻断 ${record.blocking_failures}` },
                    { title: '审批意见', dataIndex: 'approval_note', render: (value) => String(value ?? '-') },
                  ]}
                />
              </Space>
            </Card>
          ) : null}

          <PageSection title="报告导出历史" testId="reports-export-history-section">
            <DataTableShell testId="reports-export-history-table-shell">
              <Table
                size="small"
                rowKey="event_id"
                loading={exportHistoryQuery.isLoading}
                scroll={{ x: 'max-content' }}
                pagination={{ pageSize: 4 }}
                dataSource={exportHistory}
                locale={{ emptyText: '当前任务还没有导出记录。导出后会记录格式、Preflight ID 和时间。' }}
                columns={[
                  { title: '审计事件', dataIndex: 'event_id', render: (value) => <code>{value}</code> },
                  { title: '格式', render: (_, event) => <Tag color="blue">{String(asRecord(event.detail)?.file_format ?? '-')}</Tag> },
                  { title: 'Run', render: (_, event) => String(asRecord(event.detail)?.run_id ?? '-') },
                  { title: 'Preflight', render: (_, event) => String(asRecord(event.detail)?.preflight_id ?? '-') },
                  { title: '操作者', dataIndex: 'actor' },
                  { title: '时间', dataIndex: 'created_at', render: (value) => formatAuditTime(String(value ?? '')) },
                ]}
              />
            </DataTableShell>
          </PageSection>

          <Card className="flat-card" title="导出审批请求">
            <Table
              size="small"
              rowKey="request_id"
              loading={exportRequestsQuery.isLoading}
              pagination={{ pageSize: 4 }}
              dataSource={exportRequests}
              locale={{ emptyText: '当前任务还没有导出审批请求。只读角色申请后会在这里追踪审批状态。' }}
              columns={[
                { title: '申请 ID', dataIndex: 'request_id', render: (value) => <code>{value}</code> },
                { title: '格式', dataIndex: 'file_format', render: (value) => <Tag color="blue">{String(value)}</Tag> },
                { title: '申请角色', dataIndex: 'requester_role' },
                {
                  title: '状态',
                  dataIndex: 'status',
                  render: (value) => <Tag color={value === 'approved' ? 'green' : value === 'rejected' || value === 'revoked' || value === 'expired' ? 'red' : 'orange'}>{String(value)}</Tag>,
                },
                { title: '原因', dataIndex: 'reason' },
                { title: '过期时间', dataIndex: 'expires_at', render: (value) => (value ? formatAuditTime(String(value)) : '-') },
                { title: '审批人', dataIndex: 'approved_by', render: (value) => String(value ?? '-') },
                {
                  title: '操作',
                  render: (_, request) => {
                    const canRequesterRevoke = request.requester_role === exportRole && ['pending', 'approved'].includes(request.status);
                    if (request.status === 'pending') {
                      return (
                        <Space size={6} wrap>
                          <Button size="small" loading={approveExportRequestMutation.isPending} onClick={() => approveExportRequestMutation.mutate(request.request_id)}>
                            Admin 审批
                          </Button>
                          <Button size="small" danger loading={rejectExportRequestMutation.isPending} onClick={() => rejectExportRequestMutation.mutate(request.request_id)}>
                            Admin 拒绝
                          </Button>
                          {canRequesterRevoke ? (
                            <Button size="small" loading={revokeExportRequestMutation.isPending} onClick={() => revokeExportRequestMutation.mutate(request.request_id)}>
                              撤销申请
                            </Button>
                          ) : null}
                        </Space>
                      );
                    }
                    if (canRequesterRevoke) {
                      return (
                        <Button size="small" loading={revokeExportRequestMutation.isPending} onClick={() => revokeExportRequestMutation.mutate(request.request_id)}>
                          撤销申请
                        </Button>
                      );
                    }
                    return <Typography.Text type="secondary">已处理</Typography.Text>;
                  },
                },
              ]}
            />
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={14}>
              <Card className="flat-card" title="跨任务 Score Analytics" loading={scoreAnalyticsQuery.isLoading}>
                <Row gutter={[12, 12]}>
                  <Col xs={12} lg={6}>
                    <MetricTile title="任务数" value={scoreAnalytics?.summary.task_count ?? 0} icon={<DownloadOutlined />} tone="blue" note="tasks" />
                  </Col>
                  <Col xs={12} lg={6}>
                    <MetricTile title="平均通过率" value={Math.round((scoreAnalytics?.summary.average_pass_rate ?? 0) * 100)} suffix="%" icon={<DownloadOutlined />} tone="green" note="avg pass" />
                  </Col>
                  <Col xs={12} lg={6}>
                    <MetricTile title="Badcase 总数" value={scoreAnalytics?.summary.badcase_count ?? 0} icon={<DownloadOutlined />} tone="red" note="badcase" />
                  </Col>
                  <Col xs={12} lg={6}>
                    <MetricTile title="退化任务" value={scoreAnalytics?.summary.regression_count ?? 0} icon={<DownloadOutlined />} tone="amber" note="regression" />
                  </Col>
                </Row>
                <Table
                  size="small"
                  rowKey="task_id"
                  pagination={{
                    current: scoreAnalytics?.pagination?.page ?? scorePage,
                    pageSize: scoreAnalytics?.pagination?.page_size ?? scorePageSize,
                    total: scoreAnalytics?.pagination?.total_items ?? scoreAnalytics?.trend.length ?? 0,
                    showSizeChanger: false,
                    onChange: (page) => setScorePage(page),
                  }}
                  dataSource={scoreAnalytics?.trend ?? []}
                  columns={[
                    { title: '任务', dataIndex: 'task_name', render: (value, record) => value ?? record.task_id },
                    { title: 'Workflow', dataIndex: 'workflow_name' },
                    { title: '通过率', dataIndex: 'pass_rate', render: (value) => `${Math.round(Number(value ?? 0) * 100)}%` },
                    { title: 'Badcase', dataIndex: 'badcase_count' },
                    { title: 'P95', dataIndex: 'p95_latency_ms', render: (value) => `${Math.round(Number(value ?? 0))} ms` },
                    { title: '成本', dataIndex: 'cost_used', render: (value) => Number(value ?? 0).toFixed(4) },
                  ]}
                />
                {scoreAnalytics?.regressions.length ? (
                  <Alert
                    className="section-actions"
                    type="warning"
                    showIcon
                    message="退化任务"
                    description={scoreAnalytics.regressions.map((item) => item.message).join('；')}
                  />
                ) : null}
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card className="flat-card" title="成本预算">
                {budgetStatus ? (
                  <Space direction="vertical" className="full-width-control">
                    <Space wrap>
                      <Tag color={budgetStatus.status === 'exceeded' ? 'red' : budgetStatus.status === 'warning' ? 'orange' : 'green'}>{budgetStatus.status}</Tag>
                      <Tag>预算 {budgetStatus.cost_budget ?? '未设置'}</Tag>
                      <Tag>已用 {budgetStatus.cost_used.toFixed(4)}</Tag>
                      <Tag>剩余 {budgetStatus.budget_remaining == null ? '未设置' : budgetStatus.budget_remaining.toFixed(4)}</Tag>
                      <Tag>Prompt {formatTokenCount(budgetStatus.prompt_tokens)}</Tag>
                      <Tag>Completion {formatTokenCount(budgetStatus.completion_tokens)}</Tag>
                      <Tag>Total {formatTokenCount(budgetStatus.total_tokens)}</Tag>
                      <Tag>成本来源 {budgetStatus.cost_source ?? '-'}</Tag>
                    </Space>
                    <Typography.Text>{budgetStatus.message}</Typography.Text>
                  </Space>
                ) : (
                  <Typography.Text type="secondary">当前报告暂未返回预算状态。</Typography.Text>
                )}
              </Card>
              {redTeamScanMutation.data ? (
                <Card className="flat-card" title="红队扫描结果">
                  <Space wrap>
                    <Tag color={redTeamScanMutation.data.summary.status === 'blocked' ? 'red' : 'green'}>{redTeamScanMutation.data.summary.status}</Tag>
                    <Tag>风险 {redTeamScanMutation.data.summary.risk_count}</Tag>
                    <Tag>Critical {redTeamScanMutation.data.summary.critical_count}</Tag>
                  </Space>
                  <Table
                    size="small"
                    rowKey="risk_id"
                    pagination={false}
                    dataSource={redTeamScanMutation.data.risks}
                    columns={[
                      { title: '风险类型', dataIndex: 'risk_type' },
                      { title: '级别', dataIndex: 'severity', render: (value) => <Tag color={value === 'critical' ? 'red' : 'orange'}>{value}</Tag> },
                      { title: '字段', dataIndex: 'field_path' },
                      { title: '证据', dataIndex: 'evidence' },
                    ]}
                  />
                  <Space direction="vertical" className="section-actions">
                    {redTeamScanMutation.data.recommendations.map((item) => (
                      <Alert key={item.action} type="info" showIcon message={item.label} description={item.message} />
                    ))}
                  </Space>
                </Card>
              ) : null}
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} xl={6}>
              <MetricTile title="通过率" value={Math.round((report?.pass_rate ?? task.pass_rate ?? 0) * 100)} suffix="%" icon={<DownloadOutlined />} tone="green" note="pass_rate" />
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <MetricTile title="错误率" value={Math.round((report?.error_rate ?? 0) * 100)} suffix="%" icon={<DownloadOutlined />} tone="blue" note="error_rate" />
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <MetricTile title="P95 耗时" value={Math.round(report?.p95_latency_ms ?? 0)} suffix="ms" icon={<DownloadOutlined />} tone="violet" note="latency" />
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <MetricTile title="Badcase" value={task.badcase_count ?? badcases.length} icon={<DownloadOutlined />} tone="red" note="review" />
            </Col>
          </Row>

          {qualityDecision ? (
            <Card className="flat-card" title="质量决策中心">
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={6}>
                  <Typography.Text type="secondary">决策状态</Typography.Text>
                  <div><Tag color={qualityDecision.status === 'blocked' ? 'red' : qualityDecision.status === 'warning' ? 'orange' : 'green'}>{qualityDecision.status}</Tag></div>
                </Col>
                <Col xs={24} lg={18}>
                  <Space wrap>
                    <Tag>通过率 {Math.round(qualityDecision.risk_summary.pass_rate * 100)}%</Tag>
                    <Tag>错误率 {Math.round(qualityDecision.risk_summary.error_rate * 100)}%</Tag>
                    <Tag>Badcase {qualityDecision.risk_summary.badcase_count}</Tag>
                    <Tag>低分层 {qualityDecision.risk_summary.weak_segment_count}</Tag>
                  </Space>
                </Col>
              </Row>
              <Table
                size="small"
                rowKey="message"
                pagination={false}
                dataSource={qualityDecision.top_risks}
                columns={[
                  { title: '风险', dataIndex: 'type' },
                  { title: '级别', dataIndex: 'severity', render: (value) => <Tag color={value === 'critical' ? 'red' : 'orange'}>{value}</Tag> },
                  { title: '说明', dataIndex: 'message' },
                ]}
              />
              <Space wrap className="section-actions">
                {qualityDecision.next_actions.map((action) => <Button key={action.action}>{action.label}</Button>)}
              </Space>
            </Card>
          ) : null}

          {diagnostics ? (
            <Card className="flat-card" title="根因诊断">
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={8}>
                  <Space direction="vertical" className="full-width-control">
                    <Typography.Text type="secondary">主要根因</Typography.Text>
                    <Space wrap>
                      <Tag color={diagnostics.summary.status === 'healthy' ? 'green' : 'orange'}>{diagnostics.summary.status}</Tag>
                      <Tag color="blue">{causeLabel(diagnostics.summary.primary_cause)}</Tag>
                      <Tag>置信度 {Math.round(diagnostics.summary.confidence * 100)}%</Tag>
                      <Tag>证据 {diagnostics.summary.evidence_count}</Tag>
                    </Space>
                  </Space>
                </Col>
                <Col xs={24} lg={16}>
                  <Space direction="vertical" className="full-width-control">
                    {diagnostics.root_causes.slice(0, 2).map((cause) => (
                      <Alert
                        key={cause.cause_type}
                        type={cause.severity === 'critical' ? 'error' : cause.severity === 'warning' ? 'warning' : 'info'}
                        showIcon
                        message={causeLabel(cause.cause_type)}
                        description={cause.recommendation}
                      />
                    ))}
                  </Space>
                </Col>
              </Row>
              <Space wrap className="section-actions">
                <Input
                  allowClear
                  placeholder="搜索根因、证据或建议"
                  className="wide-search"
                  value={rootCauseSearch}
                  onChange={(event) => {
                    setRootCausePage(1);
                    setRootCauseSearch(event.target.value);
                  }}
                />
              </Space>
              <Table
                className="section-actions"
                size="small"
                rowKey="cause_type"
                pagination={reportQuery.data?.diagnostics_pagination?.root_causes
                  ? {
                      current: reportQuery.data.diagnostics_pagination.root_causes.page,
                      pageSize: reportQuery.data.diagnostics_pagination.root_causes.page_size,
                      total: reportQuery.data.diagnostics_pagination.root_causes.total_items,
                      showSizeChanger: false,
                      onChange: setRootCausePage,
                    }
                  : false}
                dataSource={diagnostics.root_causes}
                columns={[
                  { title: '根因', dataIndex: 'cause_type', render: (value) => causeLabel(String(value)) },
                  { title: '级别', dataIndex: 'severity', render: (value) => <Tag color={value === 'critical' ? 'red' : value === 'warning' ? 'orange' : 'blue'}>{value}</Tag> },
                  { title: '影响样本', dataIndex: 'affected_items' },
                  { title: '证据', dataIndex: 'evidence', render: (items: string[]) => items?.join('；') },
                  {
                    title: '建议动作',
                    dataIndex: 'next_actions',
                    render: (items: string[]) => (
                      <Space wrap>
                        {(items ?? []).map((item) => (
                          <Button
                            key={item}
                            size="small"
                            disabled={!task}
                            loading={diagnosticActionMutation.isPending && pendingDiagnosticAction === item}
                            onClick={() => handleDiagnosticAction(item)}
                          >
                            {actionLabel(item)}
                          </Button>
                        ))}
                      </Space>
                    ),
                  },
                ]}
              />
              <Row gutter={[16, 16]} className="section-actions">
                <Col xs={24} xl={12}>
                  <Space direction="vertical" className="full-width-control">
                    <Typography.Title level={5}>Step 健康度</Typography.Title>
                    <Input
                      allowClear
                      placeholder="搜索 Step 或 Skill"
                      value={stepSearch}
                      onChange={(event) => {
                        setStepPage(1);
                        setDiagnosticStepPage(1);
                        setStepSearch(event.target.value);
                      }}
                    />
                  </Space>
                  <Table
                    size="small"
                    rowKey="step_id"
                    pagination={reportQuery.data?.diagnostics_pagination?.step_health
                      ? {
                          current: reportQuery.data.diagnostics_pagination.step_health.page,
                          pageSize: reportQuery.data.diagnostics_pagination.step_health.page_size,
                          total: reportQuery.data.diagnostics_pagination.step_health.total_items,
                          showSizeChanger: false,
                          onChange: setDiagnosticStepPage,
                        }
                      : false}
                    dataSource={diagnostics.step_health}
                    columns={[
                      { title: 'Step', dataIndex: 'step_id' },
                      { title: 'Skill', dataIndex: 'skill_ref' },
                      { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'failed' ? 'red' : value === 'slow' ? 'orange' : 'green'}>{value}</Tag> },
                      { title: '失败', dataIndex: 'failed_calls' },
                      { title: '平均耗时', dataIndex: 'average_latency_ms', render: (value) => `${Math.round(Number(value ?? 0))} ms` },
                    ]}
                  />
                </Col>
                <Col xs={24} xl={12}>
                  <Typography.Title level={5}>数据质量</Typography.Title>
                  <Space wrap className="section-actions">
                    <Tag>样本 {diagnostics.data_quality.row_count}</Tag>
                    <Tag color={diagnostics.data_quality.duplicate_row_count ? 'orange' : 'green'}>重复 {diagnostics.data_quality.duplicate_row_count}</Tag>
                    {diagnostics.parameter_risks.override_count ? <Tag color="blue">任务覆盖 {diagnostics.parameter_risks.override_count}</Tag> : null}
                    {diagnostics.parameter_risks.secret_ref_count ? <Tag color="purple">Secret {diagnostics.parameter_risks.secret_ref_count}</Tag> : null}
                  </Space>
                  {diagnostics.data_quality.warnings.length ? (
                    <Space direction="vertical" className="full-width-control">
                      {diagnostics.data_quality.warnings.map((warning) => <Alert key={warning} type="warning" showIcon message={warning} />)}
                    </Space>
                  ) : null}
                  <Table
                    size="small"
                    rowKey="field"
                    pagination={{ pageSize: 4 }}
                    dataSource={diagnostics.data_quality.field_coverage}
                    columns={[
                      { title: '字段', dataIndex: 'field' },
                      { title: '覆盖率', dataIndex: 'coverage', render: (value) => `${Math.round(Number(value ?? 0) * 100)}%` },
                      { title: '缺失', dataIndex: 'missing_count' },
                      { title: 'Workflow 需要', dataIndex: 'required_by_workflow', render: (value) => (value ? <Tag color="blue">是</Tag> : <Tag>否</Tag>) },
                    ]}
                  />
                </Col>
              </Row>
            </Card>
          ) : null}

          <Card className="flat-card" title="Step 分布与耗时">
            <Space wrap className="section-actions">
              <Input
                allowClear
                placeholder="搜索 Step 或 Skill"
                className="wide-search"
                value={stepSearch}
                onChange={(event) => {
                  setStepPage(1);
                  setDiagnosticStepPage(1);
                  setStepSearch(event.target.value);
                }}
              />
              {reportQuery.data?.step_distribution_pagination ? (
                <Typography.Text type="secondary">
                  共 {reportQuery.data.step_distribution_pagination.total_items} 个 Step，当前第 {reportQuery.data.step_distribution_pagination.page} 页。
                </Typography.Text>
              ) : null}
            </Space>
            {stepDistribution.length ? (
              <Table
                rowKey="step_id"
                size="small"
                loading={reportQuery.isFetching}
                pagination={reportQuery.data?.step_distribution_pagination
                  ? {
                      current: reportQuery.data.step_distribution_pagination.page,
                      pageSize: reportQuery.data.step_distribution_pagination.page_size,
                      total: reportQuery.data.step_distribution_pagination.total_items,
                      showSizeChanger: false,
                      onChange: setStepPage,
                    }
                  : false}
                dataSource={stepDistribution}
                columns={[
                  { title: 'Step', dataIndex: 'step_id' },
                  { title: 'Skill', dataIndex: 'skill_ref' },
                  { title: '调用', dataIndex: 'total_calls' },
                  { title: '成功', dataIndex: 'succeeded' },
                  { title: '失败', dataIndex: 'failed' },
                  { title: '缓存命中', dataIndex: 'cache_hits' },
                  { title: '平均耗时', dataIndex: 'average_latency_ms', render: (value) => `${Math.round(Number(value ?? 0))} ms` },
                ]}
              />
            ) : null}
            <LazyECharts option={chartOption} style={{ height: 280 }} />
          </Card>

          <ReportSegmentAnalysis
            segments={reportQuery.data?.segments}
            recommendations={reportQuery.data?.recommendations}
            pagination={reportQuery.data?.segments_pagination}
            loading={reportQuery.isFetching}
            searchValue={segmentSearch}
            onSearchChange={(value) => {
              setSegmentPage(1);
              setSegmentSearch(value);
            }}
            onPageChange={setSegmentPage}
          />

          <Card className="flat-card" title="Badcase 明细">
            <Space direction="vertical" className="full-width-control">
              <Space wrap>
                <Button type="primary" disabled={!selectedBadcaseKeys.length} loading={bulkGoldenMutation.isPending} onClick={() => bulkGoldenMutation.mutate()}>
                  批量加入 Golden
                </Button>
                <Button disabled={!selectedBadcaseKeys.length || !task} loading={bulkRepairTaskMutation.isPending} onClick={() => bulkRepairTaskMutation.mutate()}>
                  批量创建修复任务
                </Button>
                <Typography.Text type="secondary">已选 {selectedBadcaseKeys.length} 条</Typography.Text>
              </Space>
              <BadcaseTable
                badcases={badcases}
                pagination={reportQuery.data?.badcase_pagination}
                task={task}
                loading={badcaseActionMutation.isPending}
                selectedRowKeys={selectedBadcaseKeys}
                onSelectionChange={setSelectedBadcaseKeys}
                onPageChange={(page) => {
                  setSelectedBadcaseKeys([]);
                  setBadcasePage(page);
                }}
                onAddGolden={(badcase) => badcaseActionMutation.mutate({ action: 'golden', badcase })}
                onIgnore={(badcase) => badcaseActionMutation.mutate({ action: 'ignore', badcase })}
                onReopen={(badcase) => badcaseActionMutation.mutate({ action: 'reopen', badcase })}
                onAddAnnotation={(badcase) => badcaseActionMutation.mutate({ action: 'annotation', badcase })}
              />
            </Space>
          </Card>
        </>
      ) : (
        <Empty description="暂无任务报告。请先在执行中心创建并执行任务。" />
      )}
    </section>
  );
}
