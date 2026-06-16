// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  ShieldAlert,
  Bug,
  CheckCircle,
  Code,
  Database,
  FlaskConical,
  PlayCircle,
  ShieldCheck,
  Wrench,
  Activity
} from 'lucide-react';

import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { MetricTile } from '../components/MetricTile';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

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
    { name: 'Experiment 快照', value: experimentsQuery.data?.length ?? 0, note: 'Run 不可变快照', icon: <FlaskConical />, tone: 'blue' },
    { name: 'Assertion DSL', value: '7 类', note: 'contains/regex/schema/latency/cost/safety', icon: <Code />, tone: 'green' },
    { name: 'CI Gate', value: '可阻断', note: '按指标阈值拦截发布', icon: <ShieldCheck />, tone: 'violet' },
    { name: 'Annotation Queue', value: annotationQuery.data?.length ?? 0, note: '失败/低分样本人工复核', icon: <ShieldAlert />, tone: 'amber' },
    { name: 'Trace Tree', value: 'Run Item', note: 'Skill 级输入输出与耗时', icon: <CheckCircle />, tone: 'blue' },
  ];

  const pendingItems = [
    { title: '待审批 Skill', count: pendingSkillPackages.length, icon: <Wrench className="text-amber-500 w-5 h-5" />, desc: '插件合约测试后需审批方可启用', link: '/skills' },
    { title: '待审核样本', count: pendingAnnotation.length, icon: <ShieldAlert className="text-violet-500 w-5 h-5" />, desc: 'Annotation Queue 待人工介入', link: '/reports' },
    { title: '失败/阻塞任务', count: failedTasks.length, icon: <Bug className="text-red-500 w-5 h-5" />, desc: `当前 CI Gate 阻断规则: ${blockingGateCount} 个`, link: '/runs' }
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
  };

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="🛡️ 评测指挥中心"
        title="工作台总览"
        description="先处理阻塞与待办项，再从主流程入口创建新的模型评测任务。"
        primaryAction={
          <>
            <Link to="/workflows">
              <Button variant="outline" size="lg" className="rounded-xl shadow-sm bg-white">
                设计 Workflow <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Link to="/runs">
              <Button size="lg" className="rounded-xl shadow-md">
                <PlayCircle className="w-4 h-4 mr-2" /> 创建任务
              </Button>
            </Link>
          </>
        }
      />

      {dashboardQuery.isError && (
        <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-100 flex items-center gap-3 text-red-800">
          <Bug className="w-5 h-5 text-red-500" />
          <div className="font-medium">Dashboard 读取失败，请确认后端服务已启动并可访问。</div>
        </div>
      )}

      <motion.div variants={containerVariants} initial="hidden" animate="show" className="flex flex-col gap-6">
        
        {/* Top Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <motion.div variants={itemVariants} className="h-full">
            <MetricTile title="数据集总量" value={summary.dataset_count} icon={<Database />} tone="blue" note="含 Golden" className="rounded-[2rem]" />
          </motion.div>
          <motion.div variants={itemVariants} className="h-full">
            <MetricTile title="已上架 Skill" value={summary.skill_count} icon={<FlaskConical />} tone="green" note="可用插件" className="rounded-[2rem]" />
          </motion.div>
          <motion.div variants={itemVariants} className="h-full">
            <MetricTile title="最近通过率" value={passRate} suffix="%" icon={<ShieldAlert />} tone="violet" note="最近执行" className="rounded-[2rem]" />
          </motion.div>
          <motion.div variants={itemVariants} className="h-full">
            <MetricTile title="待处理 Badcase" value={summary.badcase_count} icon={<Bug />} tone="amber" note="报告积累" className="rounded-[2rem]" />
          </motion.div>
        </div>

        {/* Main Activity */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <motion.div variants={itemVariants} className="xl:col-span-2 h-full">
            <Card className="h-full flex flex-col p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
                  <Activity className="w-6 h-6 text-slate-400" /> 最近评测任务
                </h3>
                <Link to="/runs" className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">查看全部</Link>
              </div>

              {recentTasks.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500">
                        <th className="pb-3 font-medium">任务名称</th>
                        <th className="pb-3 font-medium">Workflow</th>
                        <th className="pb-3 font-medium">状态</th>
                        <th className="pb-3 font-medium">进度</th>
                        <th className="pb-3 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTasks.map(task => (
                        <tr key={task.task_id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors group">
                          <td className="py-4 font-medium text-slate-700">{task.name}</td>
                          <td className="py-4 text-slate-500">{task.workflow_name}</td>
                          <td className="py-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              task.status === 'completed' ? 'bg-green-100 text-green-700' :
                              task.status === 'failed' ? 'bg-red-100 text-red-700' :
                              task.status === 'running' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {task.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-4 text-slate-500 font-mono text-xs">{task.completed_items} / {task.total_items}</td>
                          <td className="py-4">
                            <Link to={`/tasks/${task.task_id}/trace`}>
                              <Button variant="secondary" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">Trace</Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-12 opacity-60">
                  <Activity className="w-12 h-12 text-slate-300 mb-4" />
                  <div className="text-slate-500">暂无任务，快去创建一个吧</div>
                </div>
              )}
            </Card>
          </motion.div>

          <motion.div variants={itemVariants} className="xl:col-span-1 h-full">
            <Card className="h-full flex flex-col p-8">
              <h3 className="text-xl font-bold tracking-tight text-slate-800 flex items-center gap-2 mb-6">
                ⚡ 待办事项
              </h3>
              <div className="flex flex-col gap-3">
                {pendingItems.map((item, i) => (
                  <motion.div key={i} whileHover={{ x: 4, scale: 1.01 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
                    <div className="flex items-start gap-4 p-4 rounded-2xl border border-transparent hover:border-slate-100 hover:bg-slate-50 transition-colors">
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-100 shadow-sm flex items-center justify-center shrink-0">
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-700 tracking-tight">{item.title}</div>
                        <div className="text-slate-500 text-xs mt-1 truncate">{item.desc}</div>
                        <div className="mt-2 text-xs font-medium flex items-center gap-1.5">
                          {item.count > 0 ? (
                            <><span className="w-1.5 h-1.5 rounded-full bg-red-500" /><span className="text-red-500">需处理 {item.count} 项</span></>
                          ) : (
                            <><span className="w-1.5 h-1.5 rounded-full bg-green-500" /><span className="text-green-600">均已清空</span></>
                          )}
                        </div>
                      </div>
                      <Link to={item.link}>
                        <Button variant="outline" size="sm" className="bg-white">处理</Button>
                      </Link>
                    </div>
                  </motion.div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>

        {/* Bottom Capabilities */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <motion.div variants={itemVariants} className="h-full">
            <Card className="h-full flex flex-col p-8">
              <h3 className="text-xl font-bold tracking-tight text-slate-800 flex items-center gap-2 mb-6">
                📋 评测标准路径
              </h3>
              <div className="flex flex-col relative pl-6 space-y-8">
                <div className="absolute left-[11px] top-4 bottom-4 w-px bg-slate-200"></div>
                {[
                  { title: '上传数据', desc: '定义数据集结构及关联 Reference。' },
                  { title: '配置工作流', desc: '连接数据与所需 Skill 模型。' },
                  { title: '执行任务', desc: '下发数据执行评测，并观察过程。' },
                  { title: '出具报告', desc: '统计通过率，归因并沉淀 Badcase。' }
                ].map((step, i) => (
                  <div key={i} className="relative">
                    <div className="absolute -left-[30px] w-3 h-3 rounded-full bg-white border-2 border-slate-300 mt-1.5 z-10" />
                    <div className="font-semibold text-slate-700 tracking-tight">{step.title}</div>
                    <div className="text-slate-500 text-sm mt-1">{step.desc}</div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants} className="h-full">
            <Card className="h-full flex flex-col p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
                  🚀 平台进阶能力
                </h3>
                <Link to="/reports">
                  <Button variant="ghost" size="sm" className="text-slate-500">
                    探索报告中心 <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {productCapabilities.map(item => (
                  <motion.div 
                    key={item.name}
                    whileHover={{ y: -4, scale: 1.02 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="p-5 rounded-2xl border border-slate-100 bg-white shadow-sm flex flex-col"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <div className="text-slate-700 w-6 h-6">{item.icon}</div>
                      <div className="px-3 py-1 rounded-full bg-slate-50 text-slate-600 font-medium text-xs">
                        {item.value}
                      </div>
                    </div>
                    <div className="font-bold text-slate-800 text-base tracking-tight">{item.name}</div>
                    <div className="text-sm text-slate-500 mt-1">{item.note}</div>
                  </motion.div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>

      </motion.div>
    </div>
  );
}
