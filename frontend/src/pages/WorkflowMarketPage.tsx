import { ApartmentOutlined, CopyOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, Empty, Input, Row, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { demoWorkflowGraph } from '../data/demo';

export function WorkflowMarketPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [workflowQuery, setWorkflowQuery] = useState('');
  const draftsQuery = useQuery({ queryKey: ['workflow-drafts'], queryFn: api.workflowDrafts, refetchOnMount: 'always' });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows, refetchOnMount: 'always' });
  const templatesQuery = useQuery({ queryKey: ['workflow-templates'], queryFn: api.templates });
  const workflowRows = useMemo(() => {
    const rows = [
      ...(draftsQuery.data ?? []).map((draft) => ({
        key: `draft-${draft.draft_id}`,
        name: draft.name,
        type: '草稿',
        status: draft.status,
        version: '-',
        updated_at: draft.updated_at,
        action: () => navigate(`/workflows/designer/${draft.draft_id}`),
      })),
      ...(workflowsQuery.data ?? []).map((workflow) => ({
        key: `workflow-${workflow.version_id}`,
        name: workflow.name,
        type: '已发布',
        status: workflow.status,
        version: `v${workflow.version}`,
        updated_at: workflow.version_id,
        action: () => workflow.graph && navigate(`/workflows/designer/${workflow.version_id}`),
      })),
    ];
    const query = workflowQuery.trim().toLowerCase();
    return query ? rows.filter((row) => `${row.name} ${row.type} ${row.status}`.toLowerCase().includes(query)) : rows;
  }, [draftsQuery.data, navigate, workflowQuery, workflowsQuery.data]);

  const createDraftMutation = useMutation({
    mutationFn: () => api.createWorkflowDraft({ name: '未命名 Workflow', graph: { ...demoWorkflowGraph, name: '未命名 Workflow' } }),
    onSuccess: async (draft) => {
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
      navigate(`/workflows/designer/${draft.draft_id}`);
    },
  });

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="流程资产"
        title="Workflow 资产市场"
        description="先选择或创建 Workflow，再进入画布编辑。已发布版本可直接用于创建任务。"
        primaryAction={<Button type="primary" icon={<PlusOutlined />} loading={createDraftMutation.isPending} onClick={() => createDraftMutation.mutate()}>新建 Workflow</Button>}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            className="flat-card"
            title="Workflow 列表"
            extra={<Input.Search allowClear placeholder="搜索 Workflow 名称" className="wide-search" onSearch={setWorkflowQuery} onChange={(event) => setWorkflowQuery(event.target.value)} />}
          >
            <Table
              rowKey={(record) => record.key}
              pagination={{ pageSize: 8 }}
              dataSource={workflowRows}
              columns={[
                { title: 'Workflow', dataIndex: 'name', render: (value) => <Space><ApartmentOutlined /><Typography.Text strong>{value}</Typography.Text></Space> },
                { title: '类型', dataIndex: 'type', render: (value) => <Tag color={value === '草稿' ? 'orange' : 'green'}>{value}</Tag> },
                { title: '版本', dataIndex: 'version' },
                { title: '状态', dataIndex: 'status' },
                { title: '关联任务数', render: () => 0 },
                {
                  title: '操作',
                  render: (_, record) => (
                    <Space>
                      <Button icon={<EditOutlined />} onClick={record.action}>进入画布</Button>
                      <Button icon={<CopyOutlined />}>复制</Button>
                    </Space>
                  ),
                },
              ]}
              locale={{ emptyText: <Empty description="暂无 Workflow，点击右上角新建。" /> }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card className="flat-card" title="模板">
            <Space direction="vertical" className="drawer-stack">
              {(templatesQuery.data ?? []).map((template) => (
                <Card size="small" key={String(template.template_id)}>
                  <Space direction="vertical">
                    <Typography.Text strong>{String(template.name)}样例</Typography.Text>
                    <Typography.Text type="secondary">{String(template.description ?? '')}</Typography.Text>
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() =>
                        api.createWorkflowDraft({ name: String(template.name), graph: { ...demoWorkflowGraph, name: String(template.name) } }).then((draft) => navigate(`/workflows/designer/${draft.draft_id}`))
                      }
                    >
                      从样例创建
                    </Button>
                  </Space>
                </Card>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </section>
  );
}
