import {
  ApartmentOutlined,
  AuditOutlined,
  BarChartOutlined,
  ControlOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, Button, ConfigProvider, Layout, Menu, theme, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';

import { api } from './api/client';
import { FEATURE_ENV_PREFIX, type FeatureFlagKey, type FeatureFlags, getFeatureFlags, isFeatureEnabled, mergeFeatureFlags } from './features';

const OverviewPage = lazy(() => import('./pages/OverviewPage').then(({ OverviewPage }) => ({ default: OverviewPage })));
const DatasetsPage = lazy(() => import('./pages/DatasetsPage').then(({ DatasetsPage }) => ({ default: DatasetsPage })));
const SkillsPage = lazy(() => import('./pages/SkillsPage').then(({ SkillsPage }) => ({ default: SkillsPage })));
const WorkflowMarketPage = lazy(() => import('./pages/WorkflowMarketPage').then(({ WorkflowMarketPage }) => ({ default: WorkflowMarketPage })));
const WorkflowDesignerPage = lazy(() => import('./pages/WorkflowDesignerPage').then(({ WorkflowDesignerPage }) => ({ default: WorkflowDesignerPage })));
const RunsPage = lazy(() => import('./pages/RunsPage').then(({ RunsPage }) => ({ default: RunsPage })));
const TraceFlowPage = lazy(() => import('./pages/TraceFlowPage').then(({ TraceFlowPage }) => ({ default: TraceFlowPage })));
const TraceTreePage = lazy(() => import('./pages/TraceTreePage').then(({ TraceTreePage }) => ({ default: TraceTreePage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(({ ReportsPage }) => ({ default: ReportsPage })));
const RepairTasksPage = lazy(() => import('./pages/RepairTasksPage').then(({ RepairTasksPage }) => ({ default: RepairTasksPage })));
const ExperimentsPage = lazy(() => import('./pages/ExperimentsPage').then(({ ExperimentsPage }) => ({ default: ExperimentsPage })));
const CIGatesPage = lazy(() => import('./pages/CIGatesPage').then(({ CIGatesPage }) => ({ default: CIGatesPage })));
const AnnotationQueuePage = lazy(() => import('./pages/AnnotationQueuePage').then(({ AnnotationQueuePage }) => ({ default: AnnotationQueuePage })));
const CandidateAssetsPage = lazy(() => import('./pages/CandidateAssetsPage').then(({ CandidateAssetsPage }) => ({ default: CandidateAssetsPage })));
const JudgeAuditPage = lazy(() => import('./pages/JudgeAuditPage').then(({ JudgeAuditPage }) => ({ default: JudgeAuditPage })));
const GovernancePage = lazy(() => import('./pages/GovernancePage').then(({ GovernancePage }) => ({ default: GovernancePage })));

function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });
}

type NavItemConfig = {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  feature?: FeatureFlagKey;
};

const navItemConfigs: NavItemConfig[] = [
  { key: '/', icon: <BarChartOutlined />, label: <NavLink to="/">概览</NavLink> },
  { key: '/datasets', icon: <DatabaseOutlined />, label: <NavLink to="/datasets">数据集</NavLink> },
  { key: '/skills', icon: <ExperimentOutlined />, label: <NavLink to="/skills">Skill 市场</NavLink> },
  { key: '/workflows', icon: <ApartmentOutlined />, label: <NavLink to="/workflows">Workflow 市场</NavLink> },
  { key: '/runs', icon: <PlayCircleOutlined />, label: <NavLink to="/runs">执行中心</NavLink> },
  { key: '/reports', icon: <BarChartOutlined />, label: <NavLink to="/reports">报告中心</NavLink> },
  { key: '/repair-tasks', icon: <ToolOutlined />, label: <NavLink to="/repair-tasks">修复任务</NavLink>, feature: 'repair_tasks' },
  { key: '/experiments', icon: <ExperimentOutlined />, label: <NavLink to="/experiments">实验中心</NavLink>, feature: 'experiments' },
  { key: '/ci-gates', icon: <ControlOutlined />, label: <NavLink to="/ci-gates">CI Gate</NavLink>, feature: 'ci_gate' },
  { key: '/annotation-queue', icon: <FileSearchOutlined />, label: <NavLink to="/annotation-queue">人工审核</NavLink>, feature: 'annotation_queue' },
  { key: '/candidate-assets', icon: <FileSearchOutlined />, label: <NavLink to="/candidate-assets">候选资产</NavLink>, feature: 'candidate_assets' },
  { key: '/judge', icon: <AuditOutlined />, label: <NavLink to="/judge">Judge 审计</NavLink>, feature: 'judge_audit' },
  { key: '/governance', icon: <SafetyCertificateOutlined />, label: <NavLink to="/governance">治理与审计</NavLink> },
];

export function AppShell() {
  const location = useLocation();
  const selectedKey = `/${location.pathname.split('/')[1]}`.replace(/\/$/, '') || '/';
  const [queryClient] = useState(createAppQueryClient);
  const [featureFlags, setFeatureFlags] = useState(getFeatureFlags);
  useEffect(() => {
    let active = true;
    api.features()
      .then((payload) => {
        if (active) {
          setFeatureFlags((current) => mergeFeatureFlags(current, payload.flags));
        }
      })
      .catch(() => {
        // 后端 flags 只是部署期事实同步；失败时继续使用前端 env，避免开发环境空白。
      });
    return () => {
      active = false;
    };
  }, []);
  const navItems: MenuProps['items'] = navItemConfigs
    .filter((item) => !item.feature || isFeatureEnabled(item.feature, featureFlags))
    .map(({ feature: _feature, ...item }) => item);

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#2563eb',
          colorSuccess: '#0f9f6e',
          colorWarning: '#b45309',
          colorError: '#dc2626',
          borderRadius: 8,
          fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", Arial, sans-serif',
          // Vitest 的 jsdom 环境不渲染真实动画，关闭 motion 可以减少无意义的计时器等待和 act 噪声；生产环境保持 Ant Design 默认动效。
          motion: import.meta.env.MODE === 'test' ? false : undefined,
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <Layout className="app-shell">
          <Layout.Sider className="app-sider" width={252}>
            <div className="brand">
              <DeploymentUnitOutlined />
              <div>
                <strong>AegisQA</strong>
                <span>AI 评测工作台</span>
              </div>
            </div>
            <Menu className="app-menu" mode="inline" selectedKeys={[selectedKey]} items={navItems} />
          </Layout.Sider>
          <Layout className="app-main">
            <Layout.Content className="app-content">
              <Suspense fallback={<div className="route-loading" role="status">正在加载页面...</div>}>
                <Routes>
                  <Route path="/" element={<OverviewPage />} />
                  <Route path="/datasets" element={<DatasetsPage />} />
                  <Route path="/skills" element={<SkillsPage />} />
                  <Route path="/workflow" element={<WorkflowMarketPage />} />
                  <Route path="/workflows" element={<WorkflowMarketPage />} />
                  <Route path="/workflows/designer" element={<WorkflowDesignerPage />} />
                  <Route path="/workflows/designer/:draftId" element={<WorkflowDesignerPage />} />
                  <Route path="/runs" element={<RunsPage />} />
                  <Route path="/tasks/:taskId/trace" element={<TraceFlowPage />} />
                  <Route path="/tasks/:taskId/trace-tree" element={<TraceTreePage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/repair-tasks" element={<FeatureGate flags={featureFlags} feature="repair_tasks" title="修复任务"><RepairTasksPage /></FeatureGate>} />
                  <Route path="/experiments" element={<FeatureGate flags={featureFlags} feature="experiments" title="实验中心"><ExperimentsPage /></FeatureGate>} />
                  <Route path="/ci-gates" element={<FeatureGate flags={featureFlags} feature="ci_gate" title="CI Gate"><CIGatesPage /></FeatureGate>} />
                  <Route path="/annotation-queue" element={<FeatureGate flags={featureFlags} feature="annotation_queue" title="人工审核"><AnnotationQueuePage /></FeatureGate>} />
                  <Route path="/candidate-assets" element={<FeatureGate flags={featureFlags} feature="candidate_assets" title="候选资产"><CandidateAssetsPage /></FeatureGate>} />
                  <Route path="/judge" element={<FeatureGate flags={featureFlags} feature="judge_audit" title="Judge 审计"><JudgeAuditPage /></FeatureGate>} />
                  <Route path="/governance" element={<GovernancePage />} />
                </Routes>
              </Suspense>
            </Layout.Content>
          </Layout>
        </Layout>
      </QueryClientProvider>
    </ConfigProvider>
  );
}

function FeatureGate({
  flags,
  feature,
  title,
  children,
}: {
  flags: FeatureFlags;
  feature: FeatureFlagKey;
  title: string;
  children: ReactNode;
}) {
  if (isFeatureEnabled(feature, flags)) {
    return <>{children}</>;
  }
  const envName = `${FEATURE_ENV_PREFIX}${feature.toUpperCase()}`;
  return (
    <section className="page-stack">
      <Typography.Text type="secondary">Experimental / Disabled</Typography.Text>
      <Typography.Title level={2}>{title}</Typography.Title>
      <Alert
        type="warning"
        showIcon
        message="该高级模块默认关闭"
        description={`此页面仍保留路由，但不会进入主导航或主流程。需要试用时设置 ${envName}=true 后重启前端。`}
      />
      <Button href="/governance">查看治理与审计</Button>
    </section>
  );
}
