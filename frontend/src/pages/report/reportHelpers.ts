/**
 * ReportsPage 辅助函数
 *
 * 从 ReportsPage.tsx 提取的纯函数，减少主文件体积。
 */

import type { RepairTaskRecord, TaskRecord } from '../../types';

const reportExportMimeTypes: Record<string, string> = {
  html: 'text/html;charset=utf-8',
  json: 'application/json;charset=utf-8',
  jsonl: 'application/jsonl;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
};

export function downloadReportExport(exported: Record<string, unknown>, task: TaskRecord) {
  const format = typeof exported.file_format === 'string' ? exported.file_format : 'html';
  const content = normalizeExportContent(exported.content ?? exported, format);
  const filename = `${safeReportFileName(task.name || task.task_id)}.${format}`;
  const blob = new Blob([content], { type: reportExportMimeTypes[format] ?? 'text/plain;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  return filename;
}

export function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  return filename;
}

export function normalizeExportContent(content: unknown, format: string) {
  if (typeof content === 'string') return content;
  return JSON.stringify(content, null, format === 'json' ? 2 : 0);
}

export function safeReportFileName(name: string) {
  const normalized = name.trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'task-report';
}

export function formatAuditTime(value: string) {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export function formatTokenCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function releaseRecordStatusColor(status: string): string {
  if (status === 'ready_to_release') return 'green';
  if (status === 'blocked') return 'red';
  if (status.startsWith('pending')) return 'gold';
  return 'default';
}

export async function ensureBadcaseId(badcase: Record<string, unknown>, task: TaskRecord | null | undefined): Promise<string> {
  if (badcase.badcase_id) return String(badcase.badcase_id);
  if (!task?.run_id || !badcase.item_id) throw new Error('缺少 Run 或 Item 信息，无法创建 Badcase 纠错记录。');
  const { api } = await import('../../api/client');
  const created = await api.createBadcase({
    run_id: task.run_id,
    item_id: String(badcase.item_id),
    reason: String(badcase.reason ?? 'judge_fail'),
    payload: asRecord(badcase.payload) ?? badcase,
  });
  return created.badcase_id;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function causeLabel(value: string) {
  const labels: Record<string, string> = {
    healthy: '健康', runtime_error: '运行时错误', data_quality: '数据质量',
    weak_segment: '弱分层风险', judge_or_answer_quality: '回答或裁判质量', parameter_risk: '参数风险',
  };
  return labels[value] ?? value;
}

export function severityColor(value: string) {
  if (['critical', 'high', 'failed', 'blocked'].includes(value)) return 'red';
  if (['warning', 'medium'].includes(value)) return 'orange';
  if (['passed', 'healthy', 'low'].includes(value)) return 'green';
  return 'blue';
}

export function priorityColor(value: string) {
  if (value === 'high') return 'red';
  if (value === 'medium') return 'orange';
  if (value === 'low') return 'blue';
  return 'default';
}

export function actionLabel(value: string) {
  const labels: Record<string, string> = {
    open_trace_flow: '查看 Trace Flow', retry_failed_items: '重试失败项',
    open_dataset_lineage: '查看数据血缘', fix_dataset_fields: '修正数据字段',
    seed_annotation_queue: '加入人工审核', create_segment_ci_gate: '生成分层门禁',
    review_badcases: '复核 Badcase', audit_judge_profile: '审计 Judge',
    open_parameter_governance: '查看参数治理', plan_workflow_parameter_changes: '规划 Workflow 参数变更',
  };
  return labels[value] ?? value;
}

export function publishDecisionLabel(status: string) {
  if (status === 'blocked') return '不建议发布';
  if (status === 'warning') return '需要复核后发布';
  return '可以发布';
}

export function formatDiagnosticActionNotice(action: string, result: unknown) {
  const record = asRecord(result);
  if (action === 'seed_annotation_queue') return `诊断动作完成：已创建 ${Number(record?.created_count ?? 0)} 条人工审核任务。`;
  if (action === 'create_segment_ci_gate') {
    const status = String(record?.status ?? (record?.blocking ? 'blocking' : 'passed'));
    return `CI Gate 即时评估完成：${status}，可进入 CI Gate 页面固化规则。`;
  }
  if (action === 'retry_failed_items') return '失败项已提交重试，任务列表和报告会刷新最新状态。';
  if (action === 'plan_workflow_parameter_changes') {
    const parameterDiffs = Array.isArray(record?.parameter_diffs) ? record.parameter_diffs.length : 0;
    return `参数变更计划已生成：${parameterDiffs} 条参数 diff，可进入修复任务查看回滚建议。`;
  }
  return `诊断动作完成：${actionLabel(action)}。`;
}

export function selectRepairTaskForAction(repairTasks: RepairTaskRecord[], action: string): RepairTaskRecord | null {
  return repairTasks.find((task) => Array.isArray(task.next_actions) && task.next_actions.includes(action)) ?? repairTasks[0] ?? null;
}
