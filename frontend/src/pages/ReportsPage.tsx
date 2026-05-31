import { DownloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Table, Tag, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useState, type Key } from 'react';

import { api } from '../api/client';
import { MetricTile } from '../components/MetricTile';
import { PageHeader } from '../components/PageHeader';
import type { TaskRecord } from '../types';
import { BadcaseTable } from './report/BadcaseTable';
import { ReportSegmentAnalysis } from './report/ReportSegmentAnalysis';
import { ReportSummary } from './report/ReportSummary';

export function ReportsPage() {
  const queryClient = useQueryClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedBadcaseKeys, setSelectedBadcaseKeys] = useState<Key[]>([]);
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks });
  const selectedTask = tasksQuery.data?.find((task) => task.task_id === selectedTaskId) ?? tasksQuery.data?.[0] ?? null;
  const reportQuery = useQuery({
    queryKey: ['task-report', selectedTask?.task_id],
    queryFn: () => api.taskReport(selectedTask?.task_id ?? ''),
    enabled: Boolean(selectedTask?.task_id),
  });

  useEffect(() => {
    if (!selectedTaskId && tasksQuery.data?.[0]) {
      setSelectedTaskId(tasksQuery.data[0].task_id);
    }
  }, [tasksQuery.data, selectedTaskId]);

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

  const report = reportQuery.data?.report;
  const task = reportQuery.data?.task ?? selectedTask;
  const badcases = reportQuery.data?.badcases ?? [];
  const stepDistribution = reportQuery.data?.step_distribution ?? [];
  const qualityDecision = reportQuery.data?.quality_decision;
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

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="任务结果"
        title="任务报告"
        description="报告不再孤立展示指标，而是绑定具体任务，展示数据源、Workflow、执行结果、Badcase 和导出入口。"
        primaryAction={<Space><Button href={selectedTask ? `/tasks/${selectedTask.task_id}/trace` : undefined}>查看 Trace Flow</Button><Button href={selectedTask ? `/tasks/${selectedTask.task_id}/trace-tree` : undefined}>查看 Trace Tree</Button><Button type="primary" icon={<DownloadOutlined />} loading={exportMutation.isPending} onClick={() => exportMutation.mutate()}>导出 HTML / CSV</Button></Space>}
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
              onChange={setSelectedTaskId}
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
          <ReportSummary task={task} summary={reportQuery.data?.task_summary} versionSnapshot={reportQuery.data?.version_snapshot} />

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
