import { PlusCircleOutlined, RedoOutlined, StopOutlined, TeamOutlined } from '@ant-design/icons';
import { Button, Empty, Space, Table, Tag } from 'antd';
import type { Key } from 'react';

import type { TaskRecord } from '../../types';

type BadcaseTableProps = {
  badcases: Record<string, unknown>[];
  task: TaskRecord | null | undefined;
  loading: boolean;
  onAddGolden: (badcase: Record<string, unknown>) => void;
  onIgnore: (badcase: Record<string, unknown>) => void;
  onReopen: (badcase: Record<string, unknown>) => void;
  onAddAnnotation: (badcase: Record<string, unknown>) => void;
  selectedRowKeys: Key[];
  onSelectionChange: (keys: Key[]) => void;
};

export function BadcaseTable({
  badcases,
  task,
  loading,
  onAddGolden,
  onIgnore,
  onReopen,
  onAddAnnotation,
  selectedRowKeys,
  onSelectionChange,
}: BadcaseTableProps) {
  if (!badcases.length) {
    return <Empty description="当前任务没有 Badcase。低分、失败或抽样样本会在这里进入人工纠错和 Golden 沉淀。" />;
  }

  return (
    <Table
      rowKey={(record) => String(record.badcase_id ?? record.item_id)}
      rowSelection={{ selectedRowKeys, onChange: onSelectionChange }}
      pagination={{ pageSize: 5 }}
      dataSource={badcases}
      columns={[
        { title: 'Item', dataIndex: 'item_id', render: (value) => value ?? '-' },
        { title: '原因', dataIndex: 'reason', render: (value) => String(value ?? '-') },
        { title: '状态', dataIndex: 'status', render: (value) => <Tag color="orange">{String(value ?? 'open')}</Tag> },
        {
          title: '推荐动作',
          render: (_, record) => (
            <Space wrap>
              <Button
                aria-label="加入 Golden"
                icon={<PlusCircleOutlined />}
                loading={loading}
                disabled={!canCorrectBadcase(record, task)}
                onClick={() => onAddGolden(record)}
              >
                加入 Golden
              </Button>
              <Button icon={<StopOutlined />} loading={loading} disabled={!canCorrectBadcase(record, task)} onClick={() => onIgnore(record)}>
                忽略
              </Button>
              <Button icon={<RedoOutlined />} loading={loading} disabled={!record.badcase_id} onClick={() => onReopen(record)}>
                重开
              </Button>
              <Button icon={<TeamOutlined />} loading={loading} disabled={!task?.run_id} onClick={() => onAddAnnotation(record)}>
                加入审阅队列
              </Button>
            </Space>
          ),
        },
      ]}
    />
  );
}

function canCorrectBadcase(badcase: Record<string, unknown>, task: TaskRecord | null | undefined): boolean {
  return Boolean(badcase.badcase_id || (task?.run_id && badcase.item_id));
}
