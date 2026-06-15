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
import { Alert, Button, Card, Col, Empty, List, Row, Space, Steps, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { HeaderButton, PageHeader } from '../components/PageHeader';
import { MetricTile } from '../components/MetricTile';

export function OverviewPage() {
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const tasksQuery = useQuery({ queryKey: ['tasks-paged'], queryFn: () => api.tasksPage({ page: 1, pageSize: 6 }) });
  const skillPackagesQuery = useQuery({ queryKey: ['skill-packages'], queryFn: api.skillPackages });
  const experimentsQuery = useQuery({ queryKey: ['experiments'], queryFn: () => api.experiments() });
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
  const tasks = tasksQuery.data?.items ?? [];
  const recentTasks = tasks.slice(0, 6);
  const pendingSkillPackages = (skillPackagesQuery.data ?? []).filter((item) => item.status === 'pending_review');
  const pendingAnnotation = (annotationQuery.data ?? []).filter((item) => item.status !== 'reviewed');
  const failedTasks = tasks.filter((task) => task.status === 'failed' || task.failed_items > 0);
  const blockingGateCount = (ciGatesQuery.data ?? []).filter((gate) => gate.status === 'active').length;
  
  const productCapabilities = [
    { name: 'Experiment 快照', value: experimentsQuery.data?.length ?? 0, note: 'Run 不可变快照', icon: <ExperimentOutlined />, tone: 'blue' },
    { name: 'Assertion DSL', value: '7 类', note: 'contains/regex/schema/latency/cost/safety', icon: <CodeOutlined />, tone: 'green' },
    { name: 'CI Gate', value: '可阻断', note: '按指标阈值拦截发布', icon: <SafetyCertificateOutlined />, tone: 'violet' },
    { name: 'Annotation Queue', value: annotationQuery.data?.length ?? 0, note: '失败/低分样本人工复核', icon: <AuditOutlined />, tone: 'amber' },
    { name: 'Trace Tree', value: 'Run Item', note: 'Skill 级输入输出与耗时', icon: <CheckCircleOutlined />, tone: 'blue' },
  ];

  const pendingItems = [
    { title: '待审批 Skill', count: pendingSkillPackages.length, icon: <ToolOutlined className="text-amber-500" />, desc: '插件合约测试后需审批方可启用', link: '/skills' },
    { title: '待审核样本', count: pendingAnnotation.length, icon: <AuditOutlined className="text-violet-500" />, desc: 'Annotation Queue 待人工介入', link: '/reports' },
    { title: '失败/阻塞任务', count: failedTasks.length, icon: <WarningOutlined className="text-red-500" />, desc: `当前 CI Gate 阻断规则: ${blockingGateCount} 个`, link: '/runs' }
  ];

  return (
    <section className="page-stack route-fade-in" style={{ paddingBottom: 40 }}>
      {/* 统一页面头部与动作槽位 */}
      <PageHeader
        eyebrow="🛡️ 评测指挥中心"
        title="工作台总览"
        description="先处理阻塞与待办项，再从主流程入口创建新的模型评测任务。"
        primaryAction={
          <Space wrap>
            <Link to="/workflows">
              <Button icon={<ArrowRightOutlined />}>设计 Workflow</Button>
            </Link>
            <Link to="/datasets">
              <Button icon={<DatabaseOutlined />}>上传数据</Button>
            </Link>
            <Link to="/runs">
              <HeaderButton icon={<PlayCircleOutlined />}>创建任务</HeaderButton>
            </Link>
          </Space>
        }
      />

      {dashboardQuery.isError && <Alert type="error" showIcon message="Dashboard 读取失败" description="请确认后端服务已启动并可访问。" className="mb-4" />}

      {/* 顶层：核心数据仪表盘 */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="数据集总量" value={summary.dataset_count} icon={<DatabaseOutlined />} tone="blue" note="含 Golden 参考数据" className="card-enter" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="已上架 Skill" value={summary.skill_count} icon={<ExperimentOutlined />} tone="green" note="所有可用插件" className="card-enter" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="最近通过率" value={passRate} suffix="%" icon={<AuditOutlined />} tone="violet" note="最近执行的 Run" className="card-enter" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="待处理 Badcase" value={summary.badcase_count} icon={<BugOutlined />} tone="amber" note="报告中心积累项" className="card-enter" />
        </Col>
      </Row>

      {/* 中间层：最近任务 (左) + 系统待办 (右) */}
      <Row gutter={[24, 24]} className="mb-6">
        {/* 左侧宽卡：最近任务流 */}
        <Col xs={24} xl={16}>
          <Card 
            className="flat-card h-full" 
            title={<span>📊 最近评测任务</span>} 
            extra={<Link to="/runs">查看全部</Link>}
          >
            {recentTasks.length ? (
              <Table
                pagination={false}
                loading={tasksQuery.isLoading}
                rowKey="task_id"
                dataSource={recentTasks}
                size="middle"
                columns={[
                  { title: '任务名称', dataIndex: 'name', width: 200 },
                  { title: 'Workflow', dataIndex: 'workflow_name' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    render: (status) => {
                      const colorMap: Record<string, string> = {
                        completed: 'green',
                        failed: 'red',
                        running: 'blue',
                        pending: 'default',
                      };
                      return <Tag color={colorMap[status] ?? 'default'} className={status === 'running' ? 'status-pulse' : ''}>{status}</Tag>;
                    },
                  },
                  { title: '进度', render: (_, task) => `${task.completed_items} / ${task.total_items}` },
                  {
                    title: '操作',
                    render: (_, task) => (
                      <Space size="small">
                        <Link to={`/tasks/${task.task_id}/trace`}><Button type="link" size="small">Trace</Button></Link>
                        <Link to="/reports"><Button type="link" size="small">报告</Button></Link>
                      </Space>
                    ),
                  },
                ]}
              />
            ) : (
              <Empty description="暂无任务，快去创建一个吧" />
            )}
          </Card>
        </Col>

        {/* 右侧窄卡：待办事项流 */}
        <Col xs={24} xl={8}>
          <Card className="flat-card h-full" title={<span>⚡ 待办事项</span>}>
            <List
              itemLayout="horizontal"
              dataSource={pendingItems}
              renderItem={(item) => (
                <List.Item
                  actions={[<Link to={item.link} key="resolve">处理</Link>]}
                >
                  <List.Item.Meta
                    avatar={<div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-lg">{item.icon}</div>}
                    title={<span className="font-semibold">{item.title}</span>}
                    description={
                      <div className="flex flex-col">
                        <span>{item.desc}</span>
                        {item.count > 0 ? <span className="text-red-500 font-medium text-xs mt-1">需处理 {item.count} 项</span> : <span className="text-green-500 text-xs mt-1">均已清空，无需操作</span>}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      {/* 底层：快速指引与产品能力 */}
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={10}>
          <Card className="flat-card h-full" title={<span>📋 评测标准路径</span>}>
            <Steps
              direction="vertical"
              size="small"
              current={-1}
              items={[
                { title: '上传数据', description: '定义数据集结构及关联 Reference。' },
                { title: '配置工作流', description: '连接数据与所需 Skill 模型。' },
                { title: '执行任务', description: '下发数据执行评测，并观察过程。' },
                { title: '出具报告', description: '统计通过率，归因并沉淀 Badcase。' },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card 
            className="flat-card h-full" 
            title={<span>🚀 平台进阶能力</span>}
            extra={<Link to="/reports"><Button type="text" size="small" icon={<ArrowRightOutlined />}>探索报告中心</Button></Link>}
          >
            <Row gutter={[16, 16]}>
              {productCapabilities.map((item) => (
                <Col xs={24} md={12} key={item.name}>
                  <div className={`p-4 rounded-xl border border-slate-100 capability-${item.tone} hover:-translate-y-1 transition-transform`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xl">{item.icon}</span>
                      <Tag bordered={false}>{item.value}</Tag>
                    </div>
                    <div className="font-semibold text-slate-700">{item.name}</div>
                    <div className="text-xs text-slate-500 mt-1">{item.note}</div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>

      {summary.run_count > 0 && (
        <div className="text-center mt-6">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>底层 Run 资源仍由系统调度，用户视角请围绕 Task 组织业务流。</Typography.Text>
        </div>
      )}
    </section>
  );
}
