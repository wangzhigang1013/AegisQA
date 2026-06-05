import { CheckCircleOutlined, CodeOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Button, Card, Space, Tabs, Tag, Tooltip, Typography } from 'antd';

import type { DatasetVersion, GraphValidationResult, WorkflowGraph } from '../../types';
import { IssueList } from './WorkflowIssuePanels';

type WorkflowConsolePanelProps = {
  graph: WorkflowGraph;
  selectedDataset: DatasetVersion | null;
  consoleTab: string;
  consoleText: string;
  consoleResult: GraphValidationResult | Record<string, unknown> | null;
  validateLoading: boolean;
  dryRunLoading: boolean;
  onConsoleTabChange: (tab: string) => void;
  onValidate: () => void;
  onDryRun: () => void;
};

export function WorkflowConsolePanel({
  graph,
  selectedDataset,
  consoleTab,
  consoleText,
  consoleResult,
  validateLoading,
  dryRunLoading,
  onConsoleTabChange,
  onValidate,
  onDryRun,
}: WorkflowConsolePanelProps) {
  return (
    <Card
      className="flat-card"
      title="校验、试运行与输出结果"
      extra={(
        <Space wrap>
          <Button icon={<CheckCircleOutlined />} onClick={onValidate} loading={validateLoading}>校验当前画布</Button>
          <Tooltip title={!selectedDataset ? '请选择映射预览数据集' : '试运行完成后会直接切到 JSON 结果'}>
            <Button icon={<PlayCircleOutlined />} disabled={!selectedDataset} onClick={onDryRun} loading={dryRunLoading}>试运行并查看结果</Button>
          </Tooltip>
        </Space>
      )}
    >
      <Tabs
        activeKey={consoleTab}
        onChange={onConsoleTabChange}
        items={[
          {
            key: 'summary',
            label: '结果',
            children: (
              <Space direction="vertical" className="drawer-stack">
                <Typography.Text>{consoleText}</Typography.Text>
                <Space wrap>
                  <Tag color="blue">点对多</Tag>
                  <Tag color="purple">多对一</Tag>
                  <Tag color="green">队列消息：仅 item_id</Tag>
                </Space>
              </Space>
            ),
          },
          {
            key: 'issues',
            label: '错误与建议',
            children: <IssueList result={consoleResult} />,
          },
          {
            key: 'json',
            label: 'JSON',
            children: <pre><CodeOutlined /> {JSON.stringify(consoleResult ?? graph, null, 2)}</pre>,
          },
        ]}
      />
    </Card>
  );
}
