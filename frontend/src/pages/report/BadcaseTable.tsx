import { PlusCircleOutlined } from '@ant-design/icons';
import { Button, Empty, Table, Tag } from 'antd';

import type { TaskRecord } from '../../types';

type BadcaseTableProps = {
  badcases: Record<string, unknown>[];
  task: TaskRecord | null | undefined;
  loading: boolean;
  onAddGolden: (badcase: Record<string, unknown>) => void;
};

export function BadcaseTable({ badcases, task, loading, onAddGolden }: BadcaseTableProps) {
  if (!badcases.length) {
    return <Empty description="当前任务没有 Badcase。低分、失败或抽样样本会在这里进入人工纠错和 Golden 沉淀。" />;
  }

  return (
    <Table
      rowKey={(record) => String(record.badcase_id ?? record.item_id)}
      pagination={{ pageSize: 5 }}
      dataSource={badcases}
      columns={[
        { title: 'Item', dataIndex: 'item_id', render: (value) => value ?? '-' },
        { title: '原因', dataIndex: 'reason', render: (value) => String(value ?? '-') },
        { title: '状态', dataIndex: 'status', render: (value) => <Tag color="orange">{String(value ?? 'open')}</Tag> },
        {
          title: '推荐动作',
          render: (_, record) => (
            <Button
              icon={<PlusCircleOutlined />}
              loading={loading}
              disabled={!canCorrectBadcase(record, task)}
              onClick={() => onAddGolden(record)}
            >
              加入 Golden
            </Button>
          ),
        },
      ]}
    />
  );
}

function canCorrectBadcase(badcase: Record<string, unknown>, task: TaskRecord | null | undefined): boolean {
  return Boolean(badcase.badcase_id || (task?.run_id && badcase.item_id));
}
