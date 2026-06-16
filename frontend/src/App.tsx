import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { 
  BarChart3, 
  Database, 
  FlaskConical, 
  GitMerge, 
  PlayCircle,
  FileBarChart,
  Wrench,
  ShieldCheck,
  SearchCode,
  ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';
import { ErrorBoundary } from './components/ErrorBoundary';
import './i18n';

// Pages
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

const navConfig = [
  {
    group: '工作台',
    items: [
      { key: '/', icon: BarChart3, label: '概览', to: '/' },
      { key: '/datasets', icon: Database, label: '数据集', to: '/datasets' },
      { key: '/skills', icon: FlaskConical, label: 'Skill 市场', to: '/skills' },
      { key: '/workflows', icon: GitMerge, label: 'Workflow', to: '/workflows' },
    ]
  },
  {
    group: '评测',
    items: [
      { key: '/runs', icon: PlayCircle, label: '执行中心', to: '/runs' },
      { key: '/reports', icon: FileBarChart, label: '报告中心', to: '/reports' },
      { key: '/repair-tasks', icon: Wrench, label: '修复任务', to: '/repair-tasks' },
      { key: '/experiments', icon: FlaskConical, label: '实验中心', to: '/experiments' },
      { key: '/ci-gates', icon: ShieldCheck, label: 'CI Gate', to: '/ci-gates' },
    ]
  },
  {
    group: '治理',
    items: [
      { key: '/annotation-queue', icon: SearchCode, label: '人工审核', to: '/annotation-queue' },
      { key: '/candidate-assets', icon: SearchCode, label: '候选资产', to: '/candidate-assets' },
      { key: '/judge', icon: ShieldAlert, label: 'Judge 审计', to: '/judge' },
      { key: '/governance', icon: ShieldCheck, label: '治理与审计', to: '/governance' },
    ]
  }
];

export function AppShell() {
  const location = useLocation();
  const selectedKey = `/${location.pathname.split('/')[1]}`.replace(/\/$/, '') || '/';
  const [queryClient] = useState(createAppQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
        {/* Sidebar */}
        <aside className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-white flex flex-col hidden md:flex">
          <div className="flex h-16 items-center px-6 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold tracking-tight text-sm leading-tight">AegisQA</span>
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">AI 治理平台</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 custom-scrollbar">
            {navConfig.map((group, i) => (
              <div key={i}>
                <h4 className="mb-3 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest">{group.group}</h4>
                <nav className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = selectedKey === item.key;
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.key}
                        to={item.to}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 ${
                          isActive
                            ? 'bg-primary/5 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${isActive ? 'text-primary' : ''}`} />
                        {item.label}
                        {isActive && (
                          <motion.div
                            layoutId="active-nav"
                            className="absolute left-0 w-1 h-6 bg-primary rounded-r-full"
                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                          />
                        )}
                      </NavLink>
                    );
                  })}
                </nav>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-border/40">
            <div className="text-xs text-muted-foreground text-center font-medium">v0.1.0 · Local</div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 ml-0 md:ml-64 flex flex-col min-w-0 bg-[#f8fafc]">
          <div className="flex-1 px-8 py-8 md:px-12 md:py-10 mx-auto w-full max-w-[1600px]">
            <ErrorBoundary>
              <ChunkErrorBoundary>
                <Suspense fallback={
                  <div className="h-[400px] w-full flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                      <motion.div 
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, ease: "linear", duration: 1 }}
                        className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent"
                      />
                      <span className="text-sm font-medium text-muted-foreground animate-pulse">Initializing Interface...</span>
                    </div>
                  </div>
                }>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={location.pathname}
                      initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      className="h-full"
                    >
                      <Routes location={location}>
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
                    </motion.div>
                  </AnimatePresence>
                </Suspense>
              </ChunkErrorBoundary>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </QueryClientProvider>
  );
}
