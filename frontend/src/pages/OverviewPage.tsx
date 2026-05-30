import {
  ArrowRightOutlined,
  AuditOutlined,
  BugOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileDoneOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Row, Space, Steps, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { HeaderButton, PageHeader } from '../components/PageHeader';
import { MetricTile } from '../components/MetricTile';

export function OverviewPage() {
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks });
  const skillPackagesQuery = useQuery({ queryKey: ['skill-packages'], queryFn: api.skillPackages });
  const experimentsQuery = useQuery({ queryKey: ['experiments'], queryFn: api.experiments });
  const annotationQuery = useQuery({ queryKey: ['annotation-queue'], queryFn: () => api.annotationQueue() });
  const ciGatesQuery = useQuery({ queryKey: ['ci-gates'], queryFn: api.ciGateConfigs });

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
  const tasks = tasksQuery.data ?? [];
  const recentTasks = tasks.slice(0, 6);
  const pendingSkillPackages = (skillPackagesQuery.data ?? []).filter((item) => item.status === 'pending_review');
  const pendingAnnotation = (annotationQuery.data ?? []).filter((item) => item.status !== 'reviewed');
  const failedTasks = tasks.filter((task) => task.status === 'failed' || task.failed_items > 0);
  const blockingGateCount = (ciGatesQuery.data ?? []).filter((gate) => gate.status === 'active').length;
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
        description="任务工作台围绕一次评测组织信息：先看待办，再沿着数据、Workflow、任务和报告完成闭环。"
        primaryAction={
          <Space wrap>
            <Link to="/datasets">
              <Button icon={<DatabaseOutlined />}>上传数据</Button>
            </Link>
            <Link to="/workflows">
              <HeaderButton icon={<PlayCircleOutlined />}>开始一次评测</HeaderButton>
            </Link>
          </Space>
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
            <h2>任务工作台</h2>
            <p>先处理阻塞项，再从主流程入口创建新的评测任务。</p>
          </div>
          <Space wrap>
            <Link to="/datasets"><Button icon={<DatabaseOutlined />}>上传数据</Button></Link>
            <Link to="/workflows"><Button icon={<ArrowRightOutlined />}>选择 Workflow</Button></Link>
            <Link to="/runs"><Button icon={<PlayCircleOutlined />}>创建任务</Button></Link>
            <Link to="/reports"><Button icon={<FileDoneOutlined />}>查看报告</Button></Link>
          </Space>
        </div>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12} xl={6}>
            <MetricTile title="最近任务" value={tasks.length} icon={<PlayCircleOutlined />} tone="blue" note="Task 主对象" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <MetricTile title="待审批 Skill" value={pendingSkillPackages.length} icon={<ToolOutlined />} tone="amber" note="插件合约测试后启用" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <MetricTile title="待审核样本" value={pendingAnnotation.length} icon={<AuditOutlined />} tone="violet" note="Annotation Queue" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <MetricTile title="失败任务" value={failedTasks.length} icon={<WarningOutlined />} tone="red" note={`CI Gate 阻断 ${blockingGateCount}`} />
          </Col>
        </Row>
      </div>

      <div className="section-band">
        <div className="section-title-row">
          <div>
            <h2>推荐操作路径</h2>
            <p>新用户按这条路径走，就能完成一次可追溯评测。</p>
          </div>
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

      <Card className="flat-card" title="最近任务">
        {recentTasks.length ? (
          <Table
            pagination={false}
            loading={tasksQuery.isLoading}
            rowKey="task_id"
            dataSource={recentTasks}
            columns={[
              { title: '任务', dataIndex: 'name' },
              { title: '数据源', dataIndex: 'dataset_name' },
              { title: 'Workflow', dataIndex: 'workflow_name' },
              { title: '状态', dataIndex: 'status', render: (status) => <Tag color={status === 'completed' ? 'green' : status === 'failed' ? 'red' : 'blue'}>{status}</Tag> },
              { title: '进度', render: (_, task) => `${task.completed_items} / ${task.total_items}` },
              { title: 'Badcase', dataIndex: 'badcase_count' },
              {
                title: '下一步',
                render: (_, task) => (
                  <Space>
                    <Link to={`/tasks/${task.task_id}/trace`}>Trace</Link>
                    <Link to="/reports">报告</Link>
                  </Space>
                ),
              },
            ]}
          />
        ) : (
          <Empty description="暂无任务。请按主流程上传数据、发布 Workflow，再创建任务。">
            <Link to="/runs">
              <Button icon={<PlayCircleOutlined />}>创建任务</Button>
            </Link>
          </Empty>
        )}
      </Card>

      {runsQuery.data?.length ? (
        <Typography.Text type="secondary">底层 Run 仍保留为执行批次，用户主线以任务为准。</Typography.Text>
      ) : null}
    </section>
  );
}
