import {
  ArrowRightOutlined,
  AuditOutlined,
  BugOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Row, Steps, Table, Tag } from 'antd';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { HeaderButton, PageHeader } from '../components/PageHeader';
import { MetricTile } from '../components/MetricTile';

export function OverviewPage() {
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const experimentsQuery = useQuery({ queryKey: ['experiments'], queryFn: api.experiments });
  const annotationQuery = useQuery({ queryKey: ['annotation-queue'], queryFn: () => api.annotationQueue() });

  const summary = dashboardQuery.data ?? {
    dataset_count: 0,
    skill_count: 0,
    workflow_count: 0,
    run_count: 0,
    badcase_count: 0,
    pass_rate: 0,
    latest_run: null,
  };
  const passRate = Math.round(summary.pass_rate * 100);
  const recentRuns =
    runsQuery.data?.slice(0, 5).map((run) => ({
      key: run.run_id,
      run_id: run.run_id,
      status: run.status,
      total_items: run.total_items,
      item_count: run.items.length,
      queue_shape: run.queue_messages[0] ? Object.keys(run.queue_messages[0]).join(', ') : 'item_id',
    })) ?? [];
  const productCapabilities = [
    { name: 'Experiment 快照', value: experimentsQuery.data?.length ?? 0, note: 'Run 不可变快照', icon: <ExperimentOutlined /> },
    { name: 'Assertion DSL', value: '7 类', note: 'contains/regex/schema/latency/cost/safety', icon: <CodeOutlined /> },
    { name: 'CI Gate', value: '可阻断', note: '按指标阈值拦截发布', icon: <SafetyCertificateOutlined /> },
    { name: 'Annotation Queue', value: annotationQuery.data?.length ?? 0, note: '失败/低分样本人工复核', icon: <AuditOutlined /> },
    { name: 'Trace Tree', value: 'Run Item', note: 'Skill 级输入输出与耗时', icon: <CheckCircleOutlined /> },
  ];

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="工作台总览"
        title="AegisQA 评测工作台"
        description="从数据集、Skill、Workflow 到执行、报告、Badcase 和 Judge 审计的一站式评测流程。"
        primaryAction={
          <Link to="/workflows">
            <HeaderButton icon={<PlayCircleOutlined />}>开始一次评测</HeaderButton>
          </Link>
        }
      />

      {dashboardQuery.isError ? <Alert type="error" showIcon message="Dashboard 读取失败" description="请确认后端 8000 服务已经启动，并且 Vite 代理指向 /api。" /> : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="数据集数量" value={summary.dataset_count} icon={<DatabaseOutlined />} tone="blue" note="含 Golden" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="Skill 数量" value={summary.skill_count} icon={<ExperimentOutlined />} tone="green" note="已审批" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="通过率" value={passRate} suffix="%" icon={<AuditOutlined />} tone="violet" note="最近 Run" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="Badcase 数" value={summary.badcase_count} icon={<BugOutlined />} tone="amber" note="待复盘" />
        </Col>
      </Row>

      <div className="section-band">
        <div className="section-title-row">
          <div>
            <h2>推荐操作路径</h2>
            <p>新用户按这条路径走，就能完成一次可追溯评测。</p>
          </div>
          <Link to="/datasets">
            <Button icon={<ArrowRightOutlined />}>准备数据</Button>
          </Link>
        </div>
        <Steps
          responsive
          items={[
            { title: '上传或物化数据', description: '确认字段路径，如 row.question、row.reference。' },
            { title: '选择 Skill', description: '查看输入输出 schema 与权限。' },
            { title: '设计 Workflow', description: '用画布连接点对多、多对一和条件分支。' },
            { title: '创建任务', description: '把一批数据和一个已发布 Workflow 绑定成任务。' },
            { title: '复盘报告', description: '围绕任务定位 Badcase，加入 Golden 或 Prompt 候选池。' },
          ]}
        />
      </div>

      <div className="section-band">
        <div className="section-title-row">
          <div>
            <h2>产品化增强</h2>
            <p>对标 LangSmith、Braintrust、Langfuse、Promptfoo、W&B Weave 后补齐的核心能力。</p>
          </div>
          <Link to="/reports">
            <Button icon={<ArrowRightOutlined />}>查看报告</Button>
          </Link>
        </div>
        <Row gutter={[12, 12]}>
          {productCapabilities.map((item) => (
            <Col xs={24} md={12} xl={8} key={item.name}>
              <Card className="flat-card" size="small">
                <div className="metric-topline">
                  <span className="metric-icon">{item.icon}</span>
                  <Tag bordered={false}>{item.value}</Tag>
                </div>
                <h3>{item.name}</h3>
                <p>{item.note}</p>
              </Card>
            </Col>
          ))}
        </Row>
      </div>

      <Card className="flat-card" title="最近 Run 状态">
        {recentRuns.length ? (
          <Table
            pagination={false}
            loading={runsQuery.isLoading}
            dataSource={recentRuns}
            columns={[
              { title: 'Run', dataIndex: 'run_id' },
              { title: '状态', dataIndex: 'status', render: (status) => <Tag color={status === 'completed' ? 'green' : 'blue'}>{status}</Tag> },
              { title: '样本数', dataIndex: 'total_items' },
              { title: 'Item', dataIndex: 'item_count' },
              { title: '队列消息字段', dataIndex: 'queue_shape' },
            ]}
          />
        ) : (
          <Empty description="暂无 Run">
            <Link to="/runs">
              <Button icon={<PlayCircleOutlined />}>创建任务</Button>
            </Link>
          </Empty>
        )}
      </Card>
    </section>
  );
}
