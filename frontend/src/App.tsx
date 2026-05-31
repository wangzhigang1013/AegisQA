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
import { useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';

import { DatasetsPage } from './pages/DatasetsPage';
import { CIGatesPage } from './pages/CIGatesPage';
import { AnnotationQueuePage } from './pages/AnnotationQueuePage';
import { CandidateAssetsPage } from './pages/CandidateAssetsPage';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { GovernancePage } from './pages/GovernancePage';
import { JudgeAuditPage } from './pages/JudgeAuditPage';
import { OverviewPage } from './pages/OverviewPage';
import { RepairTasksPage } from './pages/RepairTasksPage';
import { ReportsPage } from './pages/ReportsPage';
import { RunsPage } from './pages/RunsPage';
import { SkillsPage } from './pages/SkillsPage';
import { TraceFlowPage } from './pages/TraceFlowPage';
import { TraceTreePage } from './pages/TraceTreePage';
import { WorkflowDesignerPage } from './pages/WorkflowDesignerPage';
import { WorkflowMarketPage } from './pages/WorkflowMarketPage';

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
  { key: '/', icon: <BarChartOutlined />, label: <NavLink to="/">概览</NavLink> },
  { key: '/datasets', icon: <DatabaseOutlined />, label: <NavLink to="/datasets">数据集</NavLink> },
  { key: '/skills', icon: <ExperimentOutlined />, label: <NavLink to="/skills">Skill 市场</NavLink> },
  { key: '/workflows', icon: <ApartmentOutlined />, label: <NavLink to="/workflows">Workflow 市场</NavLink> },
  { key: '/runs', icon: <PlayCircleOutlined />, label: <NavLink to="/runs">执行中心</NavLink> },
  { key: '/reports', icon: <BarChartOutlined />, label: <NavLink to="/reports">报告中心</NavLink> },
  { key: '/repair-tasks', icon: <ToolOutlined />, label: <NavLink to="/repair-tasks">修复任务</NavLink> },
  { key: '/experiments', icon: <ExperimentOutlined />, label: <NavLink to="/experiments">实验中心</NavLink> },
  { key: '/ci-gates', icon: <ControlOutlined />, label: <NavLink to="/ci-gates">CI Gate</NavLink> },
  { key: '/annotation-queue', icon: <FileSearchOutlined />, label: <NavLink to="/annotation-queue">人工审核</NavLink> },
  { key: '/candidate-assets', icon: <FileSearchOutlined />, label: <NavLink to="/candidate-assets">候选资产</NavLink> },
  { key: '/judge', icon: <AuditOutlined />, label: <NavLink to="/judge">Judge 审计</NavLink> },
  { key: '/governance', icon: <SafetyCertificateOutlined />, label: <NavLink to="/governance">治理与审计</NavLink> },
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
          colorSuccess: '#0f9f6e',
          colorWarning: '#b45309',
          colorError: '#dc2626',
          borderRadius: 8,
          fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", Arial, sans-serif',
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
              <Routes>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/datasets" element={<DatasetsPage />} />
                <Route path="/skills" element={<SkillsPage />} />
                <Route path="/workflow" element={<WorkflowMarketPage />} />
                <Route path="/workflows" element={<WorkflowMarketPage />} />
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
            </Layout.Content>
          </Layout>
        </Layout>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
