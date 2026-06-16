import { AlertCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';

import type { GraphIssue, GraphValidationResult } from '../../types';

export function validationErrorsFromResult(result: GraphValidationResult | Record<string, unknown> | null): GraphIssue[] {
  if (!result || typeof result !== 'object') return [];
  const errors = (result as GraphValidationResult).errors;
  return Array.isArray(errors) ? errors : [];
}

export function InlineIssueSummary({ issues, onSelectNode }: { issues: GraphIssue[]; onSelectNode: (issue: GraphIssue) => void }) {
  if (!issues.length) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 items-start">
      <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <h4 className="font-semibold text-amber-800 mb-2">当前校验问题</h4>
        <div className="flex flex-col gap-2">
          {issues.slice(0, 3).map((issue) => (
            <div key={`${issue.code}-${issue.node_id ?? issue.message}`} className="flex flex-wrap gap-2 items-center text-sm text-amber-900">
              <span>{issue.message}</span>
              {issue.node_id ? <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => onSelectNode(issue)}>定位节点 {issue.node_id}</Button> : null}
            </div>
          ))}
          {issues.length > 3 ? <p className="text-xs text-amber-700/80">还有 {issues.length - 3} 个问题，完整列表在页面底部 Console 的“错误与建议”。</p> : null}
        </div>
      </div>
    </div>
  );
}

export function NodeIssuePanel({ issues }: { issues: GraphIssue[] }) {
  if (!issues.length) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 items-start">
      <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <h4 className="font-semibold text-amber-800 mb-2">当前节点问题</h4>
        <div className="flex flex-col gap-2">
          {issues.map((issue) => (
            <div key={`${issue.code}-${issue.message}`} className="flex flex-col gap-0.5 text-sm">
              <span className="text-amber-900">{issue.message}</span>
              <span className="text-amber-700/80 text-xs">{issueRepairSuggestion(issue)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function IssueList({ result }: { result: GraphValidationResult | Record<string, unknown> | null }) {
  const errors = validationErrorsFromResult(result);
  if (!errors.length) {
    return <p className="text-slate-500 text-sm py-4">暂无校验错误。校验通过后可继续发布或试运行。</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {errors.map((error) => (
        <div key={`${error.code}-${error.node_id ?? ''}-${error.message}`} className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 items-start">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-amber-800 mb-2">{error.code}</h4>
            <div className="flex flex-col gap-1 text-sm">
              {error.node_id ? <span className="text-amber-700/80 text-xs">节点：{error.node_id}</span> : null}
              <span className="text-amber-900">{error.message}</span>
              <span className="text-amber-700/80 text-xs">{issueRepairSuggestion(error)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function issueRepairSuggestion(error: { code: string; details?: Record<string, unknown> }) {
  const details = error.details ?? {};
  if (error.code === 'UPSTREAM_OUTPUT_NOT_CONNECTED') {
    const referencedNode = stringValue(details.referenced_node_id, '被引用节点');
    const currentNode = stringValue(details.current_node_id, '当前节点');
    const missingPath = stringValue(details.missing_path, '节点ID.字段');
    return `修复建议：先从 ${referencedNode} 连接到 ${currentNode}，让画布形成明确数据依赖，再在输入绑定中使用 ${missingPath}；没有连线时执行器不会保证上游先运行。`;
  }
  if (error.code === 'MAPPING_PATH_MISSING') {
    const missingPath = stringValue(details.missing_path, '当前路径');
    return `修复建议：确认 ${missingPath} 存在于数据集字段、上游节点输出或 context/metrics 中；如果它是节点输出，请先画出对应上游连线。`;
  }
  if (error.code === 'MISSING_REQUIRED_INPUT' || error.code === 'REQUIRED_INPUT_MAPPING_MISSING') {
    const fields = stringList(details.fields).length ? stringList(details.fields) : stringList(details.missing_fields);
    const fieldText = fields.length ? `：${fields.join('、')}` : '';
    return `修复建议：在右侧 Inspector 的输入绑定中为缺失字段配置 row/context/metrics 路径${fieldText}，例如 row.question。`;
  }
  if (error.code === 'INPUT_MAPPING_PATH_EMPTY') {
    return '修复建议：清空的输入映射不会参与执行，请补充字段路径或删除该映射行。';
  }
  if (error.code === 'OUTPUT_MAPPING_PATH_EMPTY') {
    return '修复建议：输出写入路径必须指向 context、metrics、artifacts 或 steps，请补充写入位置。';
  }
  if (error.code === 'BRANCH_CONDITION_REQUIRED') {
    return '修复建议：选中 Branch 节点，在条件表达式中填写判断规则，或为每条分支连线配置 condition。';
  }
  if (error.code === 'REQUIRES_JOIN_OR_AGGREGATOR' || error.code === 'JOIN_REQUIRED') {
    const node = stringValue(details.node_id, '该节点');
    return `修复建议：${node} 有多条上游线汇入时，请先增加 Join 或 Aggregator 节点，避免结果互相覆盖。`;
  }
  if (error.code === 'GRAPH_HAS_CYCLE') {
    return '修复建议：删除形成环路的连线，保持 Workflow 为有向无环图。';
  }
  if (error.code === 'SKILL_NOT_APPROVED' || error.code === 'SKILL_NOT_AVAILABLE') {
    return '修复建议：到 Skill 市场或治理页运行合约测试并审批启用该 Skill，或替换为已启用版本。';
  }
  if (error.code === 'SKILL_NOT_FOUND') {
    return '修复建议：到 Skill 市场上传或选择已注册的 Skill；如果是旧草稿，请替换为当前可用的 Skill 版本后再发布。';
  }
  if (error.code === 'MISSING_REQUIRED_CONFIG' || error.code === 'CONFIG_REQUIRED_MISSING') {
    const fields = stringList(details.fields).length ? stringList(details.fields) : stringList(details.missing_fields);
    const fieldText = fields.length ? `：${fields.join('、')}` : '';
    return `修复建议：在右侧 Inspector 的运行参数中补齐必填参数${fieldText}；如果该参数来自任务级覆盖，请重新运行任务 Preflight 确认覆盖值。`;
  }
  if (error.code === 'CONFIG_VALUE_INVALID') {
    const fieldPath = stringValue(details.field_path, '对应字段');
    const expectedType = stringValue(details.expected_type, '声明类型');
    const actualType = stringValue(details.actual_type, '当前类型');
    return `修复建议：将参数 ${fieldPath} 改为 ${expectedType} 类型；当前检测到 ${actualType}，请在 Skill 参数表单或任务级覆盖中修正。`;
  }
  if (error.code === 'CONFIG_EXPRESSION_PATH_MISSING') {
    const rowHint = rowIndexHint(details.row_index);
    return `修复建议：检查 Dataset 预览样本${rowHint}是否存在该表达式路径，或把参数改为固定值/有效 row、context、metrics 路径后重新预检。`;
  }
  if (error.code === 'CONFIG_EXPRESSION_PATH_EMPTY') {
    return '修复建议：表达式参数必须填写 path，例如 row.temperature；不需要动态取值时请改为固定参数值。';
  }
  if (error.code === 'CONFIG_SECRET_REF_EMPTY') {
    return '修复建议：填写 Secret 引用名称，例如 LLM_API_KEY；不要把密钥明文写进 Workflow config。';
  }
  if (error.code === 'CONFIG_DYNAMIC_VALUE_INVALID' || error.code === 'CONFIG_SCHEMA_INVALID') {
    return '修复建议：检查 Skill 参数 JSON，动态参数必须使用 { type: "expression", path: "row.xxx" } 或 { type: "secret", name: "SECRET_NAME" } 结构。';
  }
  if (error.code === 'DATASET_FIELD_MISSING') {
    const field = stringValue(details.field, '缺失字段');
    const rowHint = rowIndexHint(details.row_index);
    return `修复建议：数据集${rowHint}缺少 ${field}，请切换 Dataset Version 或在数据集治理中生成修复版本。`;
  }
  return '修复建议：根据错误信息调整节点配置、连线或字段映射后重新校验。';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function rowIndexHint(value: unknown): string {
  return typeof value === 'number' ? `第 ${value + 1} 行` : '';
}
