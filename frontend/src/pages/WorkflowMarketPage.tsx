import { ApartmentOutlined, CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Input, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { demoWorkflowGraph } from '../data/demo';
import type { WorkflowDraftRecord, WorkflowGraph, WorkflowVersion } from '../types';

type WorkflowMarketRow = {
  key: string;
  name: string;
  type: '草稿' | '已发布';
  status: string;
  version: string;
  updated_at: string;
  draft?: WorkflowDraftRecord;
  workflow?: WorkflowVersion;
};

export function WorkflowMarketPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [workflowQuery, setWorkflowQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [notice, setNotice] = useState<string | null>(null);
  const draftsStatus = statusFilter === 'deleted' ? 'deleted' : undefined;
  const draftsQuery = useQuery({ queryKey: ['workflow-drafts', draftsStatus ?? 'active'], queryFn: () => api.workflowDrafts(draftsStatus), refetchOnMount: 'always' });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows, refetchOnMount: 'always' });
  const templatesQuery = useQuery({ queryKey: ['workflow-templates'], queryFn: api.templates });
  const workflowDrafts = Array.isArray(draftsQuery.data) ? draftsQuery.data : [];
  const workflowVersions = Array.isArray(workflowsQuery.data) ? workflowsQuery.data : [];
  const workflowTemplates = Array.isArray(templatesQuery.data) ? templatesQuery.data : [];
  const workflowRows = useMemo<WorkflowMarketRow[]>(() => {
    const rows: WorkflowMarketRow[] = [
      ...workflowDrafts.map((draft) => ({
        key: `draft-${draft.draft_id}`,
        name: draft.name,
        type: '草稿' as const,
        status: draft.status,
        version: '-',
        updated_at: draft.updated_at,
        draft,
      })),
      ...workflowVersions.map((workflow) => ({
        key: `workflow-${workflow.version_id}`,
        name: workflow.name,
        type: '已发布' as const,
        status: workflow.status,
        version: `v${workflow.version}`,
        updated_at: workflow.version_id,
        workflow,
      })),
    ];
    const query = workflowQuery.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (statusFilter === 'draft') return row.type === '草稿' && row.status !== 'deleted';
        if (statusFilter === 'published') return row.type === '已发布' && row.status !== 'archived';
        if (statusFilter === 'deleted') return row.type === '草稿' && row.status === 'deleted';
        if (statusFilter === 'archived') return row.type === '已发布' && row.status === 'archived';
        return row.status !== 'deleted';
      })
      .filter((row) => (query ? `${row.name} ${row.type} ${row.status}`.toLowerCase().includes(query) : true));
  }, [statusFilter, workflowDrafts, workflowQuery, workflowVersions]);

  const createDraftMutation = useMutation({
    mutationFn: () => api.createWorkflowDraft({ name: '未命名 Workflow', graph: { ...demoWorkflowGraph, name: '未命名 Workflow' } }),
    onSuccess: async (draft) => {
      queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
      navigate(`/workflows/designer/${draft.draft_id}`);
    },
  });
  const copyDraftMutation = useMutation({
    mutationFn: (draft: WorkflowDraftRecord) => api.createWorkflowDraft({ name: `${draft.name} 副本`, graph: draft.graph }),
    onSuccess: async (draft) => {
      setNotice(`Workflow 草稿已复制：${draft.name}`);
      queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
    },
  });
  const copyPublishedMutation = useMutation({
    mutationFn: (workflow: WorkflowVersion) => api.createWorkflowDraft({ name: `${workflow.name} 副本`, graph: (workflow.graph as WorkflowGraph | undefined) ?? { ...demoWorkflowGraph, name: `${workflow.name} 副本` } }),
    onSuccess: async (draft) => {
      setNotice(`已从发布版本复制为草稿：${draft.name}`);
      queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
    },
  });
  const deleteDraftMutation = useMutation({
    mutationFn: (draftId: string) => api.deleteWorkflowDraft(draftId),
    onSuccess: async (draft) => {
      setNotice(`草稿已删除：${draft.name}。已发布 Workflow 和已有任务不受影响。`);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
    },
  });
  const archiveWorkflowMutation = useMutation({
    mutationFn: (versionId: string) => api.archiveWorkflow(versionId),
    onSuccess: async (workflow) => {
      setNotice(`Workflow 已归档：${workflow.name} ${workflow.version_id}`);
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  function openDraft(draft: WorkflowDraftRecord) {
    // 市场页已经拿到了草稿图，进入画布前先写入单草稿缓存，避免画布短暂显示默认模板后再被接口刷新覆盖。
    queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
    navigate(`/workflows/designer/${draft.draft_id}`);
  }

  function openPublished(workflow: WorkflowVersion) {
    if (workflow.graph) {
      api.createWorkflowDraft({ name: `${workflow.name} 编辑草稿`, graph: workflow.graph as WorkflowGraph }).then((draft) => {
        queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
        void queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
        navigate(`/workflows/designer/${draft.draft_id}`);
      });
    }
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="流程资产"
        title="Workflow 资产市场"
        description="先选择或创建 Workflow，再进入画布编辑。已发布版本可直接用于创建任务。"
        primaryAction={<Button type="primary" icon={<PlusOutlined />} loading={createDraftMutation.isPending} onClick={() => createDraftMutation.mutate()}>新建 Workflow</Button>}
      />

      {notice ? <Alert type="success" showIcon closable message={notice} onClose={() => setNotice(null)} /> : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            className="flat-card"
            title="Workflow 列表"
            extra={
              <Space wrap>
                <Select
                  aria-label="Workflow 状态筛选"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'draft', label: '草稿' },
                    { value: 'published', label: '已发布' },
                    { value: 'deleted', label: '已删除' },
                    { value: 'archived', label: '已归档' },
                  ]}
                />
                <Input.Search allowClear placeholder="搜索 Workflow 名称" className="wide-search" onSearch={setWorkflowQuery} onChange={(event) => setWorkflowQuery(event.target.value)} />
              </Space>
            }
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
                      {record.draft ? (
                        <>
                          <Button icon={<EditOutlined />} disabled={record.status === 'deleted'} onClick={() => openDraft(record.draft!)}>进入画布</Button>
                          <Button icon={<CopyOutlined />} loading={copyDraftMutation.isPending} onClick={() => copyDraftMutation.mutate(record.draft!)}>复制草稿</Button>
                          <Popconfirm
                            title="确认删除 Workflow 草稿？"
                            description="删除后不会影响已发布 Workflow 和已有任务。"
                            okText="确认删除"
                            cancelText="取消"
                            onConfirm={() => deleteDraftMutation.mutate(record.draft!.draft_id)}
                          >
                            <Button danger icon={<DeleteOutlined />} disabled={record.status === 'deleted'} loading={deleteDraftMutation.isPending}>删除草稿</Button>
                          </Popconfirm>
                        </>
                      ) : null}
                      {record.workflow ? (
                        <>
                          <Button icon={<EditOutlined />} disabled={!record.workflow.graph} onClick={() => openPublished(record.workflow!)}>复制并编辑</Button>
                          <Button icon={<CopyOutlined />} loading={copyPublishedMutation.isPending} onClick={() => copyPublishedMutation.mutate(record.workflow!)}>复制为草稿</Button>
                          <Button danger icon={<StopOutlined />} disabled={record.status === 'archived'} loading={archiveWorkflowMutation.isPending} onClick={() => archiveWorkflowMutation.mutate(record.workflow!.version_id)}>归档</Button>
                        </>
                      ) : null}
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
              {workflowTemplates.map((template) => (
                <Card size="small" key={String(template.template_id)}>
                  <Space direction="vertical">
                    <Typography.Text strong>{String(template.name)}样例</Typography.Text>
                    <Typography.Text type="secondary">{String(template.description ?? '')}</Typography.Text>
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() => {
                        api.createWorkflowDraft({ name: String(template.name), graph: { ...demoWorkflowGraph, name: String(template.name) } }).then((draft) => {
                          queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
                          navigate(`/workflows/designer/${draft.draft_id}`);
                        });
                      }}
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
