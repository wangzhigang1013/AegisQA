import {
  ArrowRightOutlined,
  AuditOutlined,
  BugOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  PlayCircleOutlined,
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
  const workbenchQuery = useQuery({ queryKey: ['overview-workbench'], queryFn: api.workbench });

  const summary = dashboardQuery.data ?? {
    dataset_count: 0,
    skill_count: 0,
    workflow_count: 0,
    run_count: 0,
    badcase_count: 0,
    pass_rate: 0,
    latest_run: null,
  };
  const workbenchSummary = workbenchQuery.data?.summary ?? {
    task_count: 0,
    run_count: 0,
    failed_run_count: 0,
    pending_badcase_count: 0,
    gate_failure_count: 0,
    report_count: 0,
  };
  const passRate = Math.round(summary.pass_rate * 100);
  const recentTasks = workbenchQuery.data?.recent_tasks ?? [];
  const continueActions = workbenchQuery.data?.continue_actions ?? [];
  const gateFailures = workbenchQuery.data?.gate_failures ?? [];
  const recentReports = workbenchQuery.data?.recent_reports ?? [];

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
      {workbenchQuery.isError ? <Alert type="error" showIcon message="工作台读取失败" description="请确认 /overview/workbench 可用，首页不会使用演示数据回退。" /> : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="数据集数量" value={summary.dataset_count} icon={<DatabaseOutlined />} tone="blue" note="含 Golden" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricTile title="Skill 数量" value={summary.skill_count} icon={<CheckCircleOutlined />} tone="green" note="已审批" />
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
            <MetricTile title="最近任务" value={workbenchSummary.task_count} icon={<PlayCircleOutlined />} tone="blue" note="Task 主对象" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <MetricTile title="待处理 Badcase" value={workbenchSummary.pending_badcase_count} icon={<BugOutlined />} tone="amber" note="来自真实报告或已持久化坏例" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <MetricTile title="Gate 失败" value={workbenchSummary.gate_failure_count} icon={<WarningOutlined />} tone="red" note="质量门禁或报告风险" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <MetricTile title="失败任务" value={workbenchSummary.failed_run_count} icon={<FileSearchOutlined />} tone="violet" note="可进入 Trace 定位" />
          </Col>
        </Row>
      </div>

      <div className="section-band">
        <div className="section-title-row">
          <div>
            <h2>继续处理</h2>
            <p>这些入口来自真实 Task、Report、Badcase 和 Gate 状态。</p>
          </div>
          <Link to="/repair-tasks">
            <Button icon={<CheckCircleOutlined />}>修复任务</Button>
          </Link>
        </div>
        {continueActions.length ? (
          <List
            dataSource={continueActions}
            renderItem={(action) => (
              <List.Item
                actions={[
                  action.target_url ? (
                    <Link key="open" to={toAppPath(action.target_url)}>
                      打开
                    </Link>
                  ) : null,
                ]}
              >
                <List.Item.Meta
                  title={<Space><Tag color={priorityColor(action.priority)}>{action.priority ?? 'normal'}</Tag>{action.label}</Space>}
                  description={action.evidence?.length ? action.evidence.join(' / ') : action.target_url}
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty description={workbenchQuery.data?.empty_state.message || '当前没有待继续处理的真实事项。'} />
        )}
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

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card className="flat-card" title="Gate 风险">
            {gateFailures.length ? (
              <List
                dataSource={gateFailures}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      item.target_url ? (
                        <Link key="open" to={toAppPath(item.target_url)}>
                          查看报告
                        </Link>
                      ) : null,
                    ]}
                  >
                    <List.Item.Meta
                      title={<Space><Tag color="red">{item.status}</Tag>{item.task_name ?? item.task_id}</Space>}
                      description={(
                        <Space direction="vertical" size={2}>
                          <span>{item.message}</span>
                          {item.evidence?.length ? <Typography.Text type="secondary">{item.evidence.join(' / ')}</Typography.Text> : null}
                        </Space>
                      )}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="当前没有真实 Gate 失败记录。" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="flat-card" title="最近报告">
            {recentReports.length ? (
              <List
                dataSource={recentReports}
                renderItem={(report) => (
                  <List.Item
                    actions={[
                      report.target_url ? (
                        <Link key="open" to={toAppPath(report.target_url)}>
                          打开
                        </Link>
                      ) : null,
                    ]}
                  >
                    <List.Item.Meta
                      title={<Space>{report.task_name ?? report.task_id}<Tag color={report.gate_status === 'blocked' ? 'red' : 'green'}>{report.gate_status ?? report.status}</Tag></Space>}
                      description={`通过率 ${Math.round(Number(report.pass_rate ?? 0) * 100)}% / 失败 ${report.failed_items} / Badcase ${report.badcase_count}`}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="执行任务后展示最近报告摘要。" />
            )}
          </Card>
        </Col>
      </Row>

      <Card className="flat-card" title="最近任务">
        {recentTasks.length ? (
          <Table
            pagination={false}
            loading={workbenchQuery.isLoading}
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
                    <Link to={`/reports?task_id=${encodeURIComponent(task.task_id)}`}>报告</Link>
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

      {summary.run_count > 0 ? (
        <Typography.Text type="secondary">底层 Run 仍保留为执行批次，用户主线以任务为准。</Typography.Text>
      ) : null}
    </section>
  );
}

function priorityColor(priority?: string | null): string {
  if (priority === 'high') return 'red';
  if (priority === 'medium') return 'gold';
  if (priority === 'low') return 'blue';
  return 'default';
}

function toAppPath(targetUrl: string | null | undefined): string {
  if (!targetUrl) return '/';
  if (targetUrl.startsWith('http')) return '/';
  return targetUrl;
}
