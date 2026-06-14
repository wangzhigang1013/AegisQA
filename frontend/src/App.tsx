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
import { ConfigProvider, Layout, Menu, theme } from 'antd';
import type { MenuProps } from 'antd';
import { lazy, Suspense, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';

import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';
import { ErrorBoundary } from './components/ErrorBoundary';
import './i18n';

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

const navItems: MenuProps['items'] = [
  { type: 'group', label: '工作台', key: 'grp-workspace', children: [
    { key: '/', icon: <BarChartOutlined />, label: <NavLink to="/">概览</NavLink> },
    { key: '/datasets', icon: <DatabaseOutlined />, label: <NavLink to="/datasets">数据集</NavLink> },
    { key: '/skills', icon: <ExperimentOutlined />, label: <NavLink to="/skills">Skill 市场</NavLink> },
    { key: '/workflows', icon: <ApartmentOutlined />, label: <NavLink to="/workflows">Workflow</NavLink> },
  ]},
  { type: 'group', label: '评测', key: 'grp-evaluation', children: [
    { key: '/runs', icon: <PlayCircleOutlined />, label: <NavLink to="/runs">执行中心</NavLink> },
    { key: '/reports', icon: <BarChartOutlined />, label: <NavLink to="/reports">报告中心</NavLink> },
    { key: '/repair-tasks', icon: <ToolOutlined />, label: <NavLink to="/repair-tasks">修复任务</NavLink> },
    { key: '/experiments', icon: <ExperimentOutlined />, label: <NavLink to="/experiments">实验中心</NavLink> },
    { key: '/ci-gates', icon: <ControlOutlined />, label: <NavLink to="/ci-gates">CI Gate</NavLink> },
  ]},
  { type: 'group', label: '治理', key: 'grp-governance', children: [
    { key: '/annotation-queue', icon: <FileSearchOutlined />, label: <NavLink to="/annotation-queue">人工审核</NavLink> },
    { key: '/candidate-assets', icon: <FileSearchOutlined />, label: <NavLink to="/candidate-assets">候选资产</NavLink> },
    { key: '/judge', icon: <AuditOutlined />, label: <NavLink to="/judge">Judge 审计</NavLink> },
    { key: '/governance', icon: <SafetyCertificateOutlined />, label: <NavLink to="/governance">治理与审计</NavLink> },
  ]},
];

export function AppShell() {
  const location = useLocation();
  const selectedKey = `/${location.pathname.split('/')[1]}`.replace(/\/$/, '') || '/';
  const [queryClient] = useState(createAppQueryClient);

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#2563eb',
          colorSuccess: '#059669',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorInfo: '#2563eb',
          borderRadius: 10,
          borderRadiusLG: 14,
          borderRadiusSM: 6,
          fontFamily: '"DM Sans", "Segoe UI", "Microsoft YaHei", Arial, sans-serif',
          fontSize: 14,
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f0f2f5',
          colorBgElevated: '#ffffff',
          colorBorder: '#e2e8f0',
          colorBorderSecondary: '#e2e8f0',
          colorText: '#0f172a',
          colorTextSecondary: '#475569',
          colorTextTertiary: '#94a3b8',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.07)',
          boxShadowSecondary: '0 8px 24px rgba(0, 0, 0, 0.1)',
          // Vitest 的 jsdom 环境不渲染真实动画，关闭 motion 可以减少无意义的计时器等待和 act 噪声；生产环境保持 Ant Design 默认动效。
          motion: import.meta.env.MODE === 'test' ? false : undefined,
        },
        components: {
          Menu: {
            itemBg: 'transparent',
            subMenuItemBg: 'transparent',
            itemSelectedBg: 'rgba(59, 130, 246, 0.15)',
            itemHoverBg: 'rgba(59, 130, 246, 0.08)',
            itemSelectedColor: '#f8fafc',
            itemColor: '#94a3b8',
            itemHoverColor: '#f8fafc',
            itemActiveBg: 'rgba(59, 130, 246, 0.12)',
            groupTitleColor: '#64748b',
            fontSize: 14,
            itemHeight: 40,
            itemMarginBlock: 2,
            itemMarginInline: 8,
            itemBorderRadius: 6,
            iconSize: 16,
          },
          Card: {
            headerBg: 'transparent',
            paddingLG: 20,
            borderRadiusLG: 10,
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
            rowHoverBg: '#eff6ff',
            borderColor: '#e2e8f0',
            cellPaddingBlock: 12,
            cellPaddingInline: 16,
          },
          Button: {
            borderRadius: 8,
            controlHeight: 36,
            fontWeight: 500,
          },
          Input: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Select: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Tag: {
            borderRadiusSM: 6,
          },
          Statistic: {
            titleFontSize: 13,
            contentFontSize: 28,
          },
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
                <span>AI 评测治理平台</span>
              </div>
            </div>
            <Menu className="app-menu" mode="inline" selectedKeys={[selectedKey]} items={navItems} />
            <div className="sider-footer">
              <span>v0.1.0 · Local</span>
            </div>
          </Layout.Sider>
          <Layout className="app-main">
            <Layout.Content className="app-content">
              <ErrorBoundary>
                <ChunkErrorBoundary>
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
                  <Route path="/repair-tasks" element={<RepairTasksPage />} />
                  <Route path="/experiments" element={<ExperimentsPage />} />
                  <Route path="/ci-gates" element={<CIGatesPage />} />
                  <Route path="/annotation-queue" element={<AnnotationQueuePage />} />
                  <Route path="/candidate-assets" element={<CandidateAssetsPage />} />
                  <Route path="/judge" element={<JudgeAuditPage />} />
                  <Route path="/governance" element={<GovernancePage />} />
                </Routes>
                  </Suspense>
                </ChunkErrorBoundary>
              </ErrorBoundary>
            </Layout.Content>
          </Layout>
        </Layout>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
