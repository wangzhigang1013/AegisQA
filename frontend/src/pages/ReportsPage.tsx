import { DownloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Table, Tag, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useState, type Key } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import { MetricTile } from '../components/MetricTile';
import { PageHeader } from '../components/PageHeader';
import type { TaskRecord } from '../types';
import { BadcaseTable } from './report/BadcaseTable';
import { ReportSegmentAnalysis } from './report/ReportSegmentAnalysis';
import { ReportSummary } from './report/ReportSummary';

export function ReportsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const taskIdFromUrl = searchParams.get('task_id');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDiagnosticAction, setPendingDiagnosticAction] = useState<string | null>(null);
  const [selectedBadcaseKeys, setSelectedBadcaseKeys] = useState<Key[]>([]);
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks });
  const scoreAnalyticsQuery = useQuery({ queryKey: ['score-analytics'], queryFn: api.scoreAnalytics });
  const selectedTask = tasksQuery.data?.find((task) => task.task_id === selectedTaskId) ?? tasksQuery.data?.[0] ?? null;
  const reportQuery = useQuery({
    queryKey: ['task-report', selectedTask?.task_id],
    queryFn: () => api.taskReport(selectedTask?.task_id ?? ''),
    enabled: Boolean(selectedTask?.task_id),
  });

  useEffect(() => {
    if (taskIdFromUrl && taskIdFromUrl !== selectedTaskId && tasksQuery.data?.some((task) => task.task_id === taskIdFromUrl)) {
      setSelectedTaskId(taskIdFromUrl);
      return;
    }
    if (!selectedTaskId && tasksQuery.data?.[0]) {
      setSelectedTaskId(tasksQuery.data[0].task_id);
    }
  }, [taskIdFromUrl, tasksQuery.data, selectedTaskId]);

  function changeSelectedTask(nextTaskId: string) {
    setSelectedTaskId(nextTaskId);
    setSearchParams(nextTaskId ? { task_id: nextTaskId } : {});
  }

  const exportMutation = useMutation({
    mutationFn: () => {
      if (!selectedTask) {
        throw new Error('请先选择任务，再导出报告。');
      }
      return api.exportReport(selectedTask.run_id, 'html');
    },
    onSuccess: () => setNotice('报告导出成功：HTML 内容已由后端生成。'),
    onError: (error) => setNotice(error instanceof Error ? error.message : '报告导出失败'),
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
      throw new Error(`当前诊断动作暂不支持：${actionLabel(action)}`);
    },
    onSuccess: async ({ action, result }) => {
      setNotice(formatDiagnosticActionNotice(action, result));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['task-report', selectedTask?.task_id] }),
        queryClient.invalidateQueries({ queryKey: ['annotation-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['ci-gate-evaluations'] }),
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
  const scoreAnalytics = scoreAnalyticsQuery.data;
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

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="任务结果"
        title="任务报告"
        description="报告不再孤立展示指标，而是绑定具体任务，展示数据源、Workflow、执行结果、Badcase 和导出入口。"
        primaryAction={
          <Space>
            <Button href={selectedTask ? `/tasks/${selectedTask.task_id}/trace` : undefined}>查看 Trace Flow</Button>
            <Button href={selectedTask ? `/tasks/${selectedTask.task_id}/trace-tree` : undefined}>查看 Trace Tree</Button>
            <Button disabled={!selectedTask} loading={redTeamScanMutation.isPending} onClick={() => redTeamScanMutation.mutate()}>运行红队扫描</Button>
            <Button type="primary" icon={<DownloadOutlined />} loading={exportMutation.isPending} onClick={() => exportMutation.mutate()}>导出 HTML / CSV</Button>
          </Space>
        }
      />

      {notice ? <Alert type={notice.includes('失败') || notice.includes('请先') ? 'warning' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Card className="flat-card" title="报告列表">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} lg={8}>
            <Select
              placeholder="选择任务"
              className="full-width-control"
              value={selectedTask?.task_id}
              loading={tasksQuery.isLoading}
              onChange={changeSelectedTask}
              options={(tasksQuery.data ?? []).map((item) => ({ value: item.task_id, label: `${item.name} / ${item.status}` }))}
            />
          </Col>
          <Col xs={24} lg={16}>
            {task ? (
              <Space wrap>
                <Tag color="blue">{task.dataset_name} v{task.dataset_version}</Tag>
                <Tag color="purple">{task.workflow_name}</Tag>
                <Tag color={task.status === 'completed' ? 'green' : 'orange'}>{task.status}</Tag>
              </Space>
            ) : (
              <Typography.Text type="secondary">暂无任务报告，请先在执行中心创建任务。</Typography.Text>
            )}
          </Col>
        </Row>
      </Card>

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
                    {diagnostics?.root_causes[0]?.recommendation ?? qualityDecision.top_risks[0]?.message ?? '当前任务未发现阻断性风险。'}
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
                    生成修复任务
                  </Button>
                </Col>
              </Row>
            </Card>
          ) : null}

          <ReportSummary task={task} summary={reportQuery.data?.task_summary} versionSnapshot={reportQuery.data?.version_snapshot} preflightEvidence={reportQuery.data?.preflight_evidence} />

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
                  pagination={{ pageSize: 4 }}
                  dataSource={scoreAnalytics?.trend ?? []}
                  columns={[
                    { title: '任务', dataIndex: 'task_name', render: (value, record) => value ?? record.task_id },
                    { title: 'Workflow', dataIndex: 'workflow_name' },
                    { title: '通过率', dataIndex: 'pass_rate', render: (value) => `${Math.round(Number(value ?? 0) * 100)}%` },
                    { title: 'Badcase', dataIndex: 'badcase_count' },
                    { title: 'P95', dataIndex: 'p95_latency_ms', render: (value) => `${Math.round(Number(value ?? 0))} ms` },
                    { title: '估算成本', dataIndex: 'cost_used', render: (value) => Number(value ?? 0).toFixed(4) },
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
              <Table
                className="section-actions"
                size="small"
                rowKey="cause_type"
                pagination={false}
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
                  <Typography.Title level={5}>Step 健康度</Typography.Title>
                  <Table
                    size="small"
                    rowKey="step_id"
                    pagination={false}
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
            {stepDistribution.length ? (
              <Table
                rowKey="step_id"
                size="small"
                pagination={false}
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
            <ReactECharts option={chartOption} style={{ height: 280 }} />
          </Card>

          <ReportSegmentAnalysis segments={reportQuery.data?.segments} recommendations={reportQuery.data?.recommendations} />

          <Card className="flat-card" title="Badcase 明细">
            <Space direction="vertical" className="full-width-control">
              <Button type="primary" disabled={!selectedBadcaseKeys.length} loading={bulkGoldenMutation.isPending} onClick={() => bulkGoldenMutation.mutate()}>
                批量加入 Golden
              </Button>
              <BadcaseTable
                badcases={badcases}
                task={task}
                loading={badcaseActionMutation.isPending}
                selectedRowKeys={selectedBadcaseKeys}
                onSelectionChange={setSelectedBadcaseKeys}
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

async function ensureBadcaseId(badcase: Record<string, unknown>, task: TaskRecord | null | undefined): Promise<string> {
  if (badcase.badcase_id) {
    return String(badcase.badcase_id);
  }
  if (!task?.run_id || !badcase.item_id) {
    throw new Error('缺少 Run 或 Item 信息，无法创建 Badcase 纠错记录。');
  }
  // 聚合报告里的 Badcase 可能只是即时分析结果，还没有进入人工纠错表；
  // 加入 Golden 前先创建正式 Badcase，后续状态流转和审计才能追踪。
  const created = await api.createBadcase({
    run_id: task.run_id,
    item_id: String(badcase.item_id),
    reason: String(badcase.reason ?? 'judge_fail'),
    payload: asRecord(badcase.payload) ?? badcase,
  });
  return created.badcase_id;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function causeLabel(value: string) {
  const labels: Record<string, string> = {
    healthy: '健康',
    runtime_error: '运行时错误',
    data_quality: '数据质量',
    weak_segment: '弱分层风险',
    judge_or_answer_quality: '回答或裁判质量',
    parameter_risk: '参数风险',
  };
  return labels[value] ?? value;
}

function actionLabel(value: string) {
  const labels: Record<string, string> = {
    open_trace_flow: '查看 Trace Flow',
    retry_failed_items: '重试失败项',
    open_dataset_lineage: '查看数据血缘',
    fix_dataset_fields: '修正数据字段',
    seed_annotation_queue: '加入人工审核',
    create_segment_ci_gate: '生成分层门禁',
    review_badcases: '复核 Badcase',
    audit_judge_profile: '审计 Judge',
    open_parameter_governance: '查看参数治理',
  };
  return labels[value] ?? value;
}

function publishDecisionLabel(status: string) {
  if (status === 'blocked') return '不建议发布';
  if (status === 'warning') return '需要复核后发布';
  return '可以发布';
}

function formatDiagnosticActionNotice(action: string, result: unknown) {
  const record = asRecord(result);
  if (action === 'seed_annotation_queue') {
    return `诊断动作完成：已创建 ${Number(record?.created_count ?? 0)} 条人工审核任务。`;
  }
  if (action === 'create_segment_ci_gate') {
    const status = String(record?.status ?? (record?.blocking ? 'blocking' : 'passed'));
    return `CI Gate 即时评估完成：${status}，可进入 CI Gate 页面固化规则。`;
  }
  if (action === 'retry_failed_items') {
    return '失败项已提交重试，任务列表和报告会刷新最新状态。';
  }
  return `诊断动作完成：${actionLabel(action)}。`;
}
