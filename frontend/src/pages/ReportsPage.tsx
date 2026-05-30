import { DownloadOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Table, Tag, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { MetricTile } from '../components/MetricTile';
import { PageHeader } from '../components/PageHeader';
import type { BadcaseRecord } from '../types';

export function ReportsPage() {
  const queryClient = useQueryClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const correctBadcaseMutation = useMutation({
    mutationFn: (badcase: BadcaseRecord) =>
      api.correctBadcase(badcase.badcase_id, {
        human_label: 'fail',
        problem_type: badcase.problem_type ?? 'manual_review',
        note: '从任务报告加入 Golden 候选。',
        add_to_golden: true,
      }),
    onSuccess: async () => {
      setNotice('Badcase 已加入 Golden 候选。');
      await queryClient.invalidateQueries({ queryKey: ['task-report', selectedTask?.task_id] });
    },
    onError: (error) => setNotice(error instanceof Error ? `Badcase 操作失败：${error.message}` : 'Badcase 操作失败'),
  });

  const report = reportQuery.data?.report;
  const task = reportQuery.data?.task ?? selectedTask;
  const badcases = reportQuery.data?.badcases ?? [];
  const latencyData = useMemo(() => {
    const metrics = report?.metrics ?? {};
    const stepMetrics = Object.entries(metrics).filter(([key]) => key.includes('latency') || key.includes('耗时'));
    return stepMetrics.length ? Object.fromEntries(stepMetrics) : { Source: 8, Skill: report?.average_latency_ms ?? 0, Judge: report?.p95_latency_ms ?? 0 };
  }, [report]);
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
        primaryAction={<Button type="primary" icon={<DownloadOutlined />} loading={exportMutation.isPending} onClick={() => exportMutation.mutate()}>导出 HTML / CSV</Button>}
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
          <Card className="flat-card" title="任务摘要">
            <Table
              rowKey="task_id"
              pagination={false}
              dataSource={[task]}
              columns={[
                { title: '任务', dataIndex: 'name' },
                { title: '数据源', dataIndex: 'dataset_name' },
                { title: 'Workflow', dataIndex: 'workflow_name' },
                { title: '样本量', dataIndex: 'total_items' },
                { title: '已执行', dataIndex: 'completed_items' },
                { title: '失败', dataIndex: 'failed_items' },
                { title: 'Badcase', dataIndex: 'badcase_count' },
              ]}
            />
          </Card>

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

          <Card className="flat-card" title="Step 耗时分布">
            <ReactECharts option={chartOption} style={{ height: 280 }} />
          </Card>

          <Card className="flat-card" title="Badcase 明细">
            {badcases.length ? (
              <Table
                rowKey={(record) => String(record.badcase_id ?? record.item_id)}
                pagination={{ pageSize: 5 }}
                dataSource={badcases}
                columns={[
                  { title: 'Item', dataIndex: 'item_id', render: (value) => value ?? '-' },
                  { title: '原因', dataIndex: 'reason', render: (value) => String(value ?? '-') },
                  { title: '状态', dataIndex: 'status', render: (value) => <Tag color="orange">{String(value ?? 'open')}</Tag> },
                  {
                    title: '推荐动作',
                    render: (_, record) => (
                      <Button
                        icon={<PlusCircleOutlined />}
                        loading={correctBadcaseMutation.isPending}
                        disabled={!record.badcase_id}
                        onClick={() => correctBadcaseMutation.mutate(record as BadcaseRecord)}
                      >
                        加入 Golden
                      </Button>
                    ),
                  },
                ]}
              />
            ) : (
              <Empty description="当前任务没有 Badcase。低分、失败或抽样样本会在这里进入人工纠错和 Golden 沉淀。" />
            )}
          </Card>
        </>
      ) : (
        <Empty description="暂无任务报告。请先在执行中心创建并执行任务。" />
      )}
    </section>
  );
}
