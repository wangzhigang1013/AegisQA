import { Alert, Card, Col, Empty, Row, Space, Table, Tag, Typography } from 'antd';

import type { TaskReport } from '../../types';

type ReportSegmentAnalysisProps = {
  segments?: TaskReport['segments'];
  recommendations?: TaskReport['recommendations'];
};

export function ReportSegmentAnalysis({ segments = [], recommendations = [] }: ReportSegmentAnalysisProps) {
  return (
    <Card className="flat-card" title="分层分析">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          {segments.length ? (
            <Table
              rowKey={(row) => `${row.segment_key}:${row.segment_value}`}
              size="small"
              pagination={{ pageSize: 6 }}
              dataSource={segments}
              columns={[
                {
                  title: '分组',
                  render: (_, row) => <Typography.Text strong>{row.segment_key}={row.segment_value}</Typography.Text>,
                },
                { title: '样本数', dataIndex: 'sample_count' },
                { title: '通过', dataIndex: 'pass_count' },
                { title: '失败', dataIndex: 'fail_count' },
                { title: 'Badcase', dataIndex: 'badcase_count' },
                {
                  title: '通过率',
                  dataIndex: 'pass_rate',
                  render: (value) => {
                    const percent = Math.round(Number(value ?? 0) * 100);
                    return <Tag color={percent >= 80 ? 'green' : percent >= 60 ? 'orange' : 'red'}>{percent}%</Tag>;
                  },
                },
              ]}
            />
          ) : (
            <Empty description="当前报告没有可分层字段。建议在数据集中补充 scene、expected_label、model_version 或 prompt_version。" />
          )}
        </Col>
        <Col xs={24} xl={8}>
          <Space direction="vertical" className="drawer-stack">
            <Typography.Text strong>下一步建议</Typography.Text>
            {recommendations.length ? (
              recommendations.map((item) => (
                <Alert
                  key={`${item.action}:${item.segment_key ?? 'global'}:${item.segment_value ?? 'all'}`}
                  type={item.severity === 'critical' ? 'error' : item.severity === 'warning' ? 'warning' : 'info'}
                  showIcon
                  message={item.title}
                  description={item.message}
                />
              ))
            ) : (
              <Alert type="success" showIcon message="暂无阻断建议" description="当前分层通过率没有低于阈值的明显短板，可以继续观察跨任务趋势。" />
            )}
          </Space>
        </Col>
      </Row>
    </Card>
  );
}
