import { CheckCircle } from 'lucide-react';
import type { SkillManifest, SkillPackageRecord } from '../../types';
import { Modal, Button } from '../../components/AntdShims';
import { Card } from '../../components/ui/Card';

type SkillApprovalDrawerProps = {
  open: boolean;
  skill: SkillManifest | null;
  packageRecord?: SkillPackageRecord;
  loading?: boolean;
  onClose: () => void;
  onApprove: (skill: SkillManifest) => void;
};

export function SkillApprovalDrawer({ open, skill, packageRecord, loading = false, onClose, onApprove }: SkillApprovalDrawerProps) {
  const isPackageSkill = Boolean(packageRecord);
  const canApprove = !isPackageSkill || Boolean(packageRecord?.last_contract_ok);
  const contractText = packageRecord ? (packageRecord.last_contract_ok ? '合约已通过' : '合约未通过') : '非上传包';
  const packageSecurity = packageRecord?.package_security;

  return (
    <Modal open={open} onCancel={onClose} title="Skill 审批详情">
      {skill ? (
        <div className="space-y-6 mt-4 max-h-[80vh] overflow-y-auto pr-2">
          {!canApprove && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-md flex gap-3">
              <div>
                <h4 className="font-medium">未通过合约测试不能启用</h4>
                <p className="text-sm mt-1">请先在 Skill 市场运行合约测试，确认输入输出 schema 和 handler 返回结构稳定后再审批。</p>
              </div>
            </div>
          )}

          <div className="border border-gray-200 rounded-md overflow-hidden">
            <dl className="divide-y divide-gray-200 text-sm">
              <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">Skill ID</dt><dd className="w-2/3 px-4 py-2"><code className="bg-gray-100 px-1 rounded">{skill.skill_id}</code></dd></div>
              <div className="flex bg-white"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">状态</dt><dd className="w-2/3 px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded text-xs ${skill.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>{formatSkillStatus(skill.status)}</span></dd></div>
              <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">运行方式</dt><dd className="w-2/3 px-4 py-2">{packageRecord?.runtime_mode ?? '内置 Skill'}</dd></div>
              <div className="flex bg-white"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">入口文件</dt><dd className="w-2/3 px-4 py-2">{packageRecord?.entrypoint ?? '-'}</dd></div>
              <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">权限声明</dt><dd className="w-2/3 px-4 py-2">{renderPermissions(skill.permissions)}</dd></div>
              <div className="flex bg-white"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">包大小</dt><dd className="w-2/3 px-4 py-2">{packageSecurity ? `${formatBytes(packageSecurity.total_size_bytes)} / ${packageSecurity.file_count} 个文件` : '-'}</dd></div>
              <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">单文件峰值</dt><dd className="w-2/3 px-4 py-2">{packageSecurity ? formatBytes(packageSecurity.max_file_size_bytes) : '-'}</dd></div>
              <div className="flex bg-white"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">合约测试</dt><dd className="w-2/3 px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded text-xs ${packageRecord?.last_contract_ok ? 'bg-green-100 text-green-800' : packageRecord ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>{contractText}</span></dd></div>
              <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">合约测试时间</dt><dd className="w-2/3 px-4 py-2">{packageRecord?.last_contract_at ?? '未执行'}</dd></div>
              <div className="flex bg-white"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">审批人</dt><dd className="w-2/3 px-4 py-2">{packageRecord?.approved_by ?? '未审批'}</dd></div>
              <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">审批时间</dt><dd className="w-2/3 px-4 py-2">{packageRecord?.approved_at ?? '未审批'}</dd></div>
            </dl>
          </div>

          <Card title="Manifest">
            <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">{JSON.stringify(skill, null, 2)}</pre>
          </Card>
          <Card title="输入 Schema">
            <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">{JSON.stringify(skill.input_schema, null, 2)}</pre>
          </Card>
          <Card title="输出 Schema">
            <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">{JSON.stringify(skill.output_schema, null, 2)}</pre>
          </Card>
          <Card title="测试日志">
            {packageRecord?.last_contract_result ? <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">{JSON.stringify(packageRecord.last_contract_result, null, 2)}</pre> : <p className="text-sm text-gray-500">暂无合约测试日志</p>}
          </Card>

          <div className="flex justify-end pt-4 border-t">
            <Button variant="primary" icon={<CheckCircle className="w-4 h-4" />} disabled={!canApprove} loading={loading} onClick={() => onApprove(skill)}>
              审批启用
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function formatSkillStatus(status: string): string {
  return {
    approved: '已启用',
    pending_review: '待审批',
    disabled: '已禁用',
    deprecated: '已废弃',
  }[status] ?? status;
}

function renderPermissions(permissions: string[]) {
  if (!permissions.length) {
    return <span className="inline-block px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs">无额外权限</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {permissions.map((item) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs ${item.includes('network') ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}`} key={item}>{item}</span>
      ))}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}
