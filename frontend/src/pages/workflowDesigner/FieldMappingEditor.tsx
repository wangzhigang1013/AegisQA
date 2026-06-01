import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Input, Space, Table, Tag, Tooltip, Typography } from 'antd';

type MappingRow = {
  id: string;
  field: string;
  path: string;
  fieldType?: string;
  required?: boolean;
  fromSchema?: boolean;
};

type FieldMappingEditorProps = {
  title: string;
  value: Record<string, string>;
  pathOptions: string[];
  onChange: (value: Record<string, string>) => void;
  addButtonLabel?: string;
  schema?: Record<string, unknown> | null;
  description?: string;
};

export function FieldMappingEditor({ title, value, pathOptions, onChange, addButtonLabel = '新增映射', schema, description }: FieldMappingEditorProps) {
  const schemaFields = schemaToRows(schema);
  const schemaFieldSet = new Set(schemaFields.map((row) => row.field));
  const legacyRows: MappingRow[] = Object.entries(value ?? {})
    .filter(([field]) => !schemaFieldSet.has(field))
    .map(([field, path]) => ({ id: field, field, path, fromSchema: false }));
  const rows: MappingRow[] = [
    ...schemaFields.map((row) => ({ ...row, path: value?.[row.field] ?? '' })),
    ...legacyRows,
  ];
  const options = buildSelectOptions(pathOptions, rows);
  const lockedBySchema = schemaFields.length > 0;
  const isOutputMapping = title.includes('输出');
  const fieldLabel = isOutputMapping ? '输出字段' : '输入字段';
  const requiredLabel = isOutputMapping ? 'Skill 必返输出' : '必填输入';
  const requiredHelp = isOutputMapping
    ? '来自 output_schema.required，表示 Skill handler 必须返回该字段；是否写给下游由“输出写入”决定。'
    : '来自 input_schema.required，发布和执行前必须绑定到数据集字段或上游输出。';

  function updateRow(row: MappingRow, patch: Partial<MappingRow>) {
    const nextRow = { ...row, ...patch };
    const nextEntries = rows.map((item) => (item.id === row.id ? nextRow : item));
    onChange(rowsToMapping(nextEntries));
  }

  function deleteRow(row: MappingRow) {
    onChange(rowsToMapping(rows.filter((item) => item.id !== row.id)));
  }

  function addRow() {
    const nextField = uniqueFieldName(rows);
    onChange({ ...(value ?? {}), [nextField]: pathOptions[0] ?? '' });
  }

  return (
    <Space direction="vertical" className="drawer-stack">
      <Space direction="vertical" size={2}>
        <Typography.Text strong>{title}</Typography.Text>
        <Typography.Text type="secondary">{description ?? '从 row、context、metrics 中选择字段路径，避免手写 JSON 出错。'}</Typography.Text>
        {isOutputMapping ? (
          <Typography.Text type="secondary">Skill 必返输出表示 handler 会返回该字段；是否写入下游由“输出写入”决定。</Typography.Text>
        ) : null}
      </Space>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: '暂无映射，请新增字段。' }}
        columns={[
          {
            title: '字段',
            dataIndex: 'field',
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <Typography.Text>{fieldLabel} {row.field}</Typography.Text>
                <Space size={4}>
                  {row.required ? (
                    <Tooltip title={requiredHelp}>
                      <Tag color={isOutputMapping ? 'red' : 'volcano'}>{requiredLabel}</Tag>
                    </Tooltip>
                  ) : null}
                  {row.fieldType ? <Typography.Text type="secondary">{row.fieldType}</Typography.Text> : null}
                </Space>
                {!row.fromSchema ? (
                  <Input
                    aria-label={`映射字段 ${row.field}`}
                    value={row.field}
                    onChange={(event) => updateRow(row, { field: event.target.value })}
                    placeholder="例如 question"
                  />
                ) : null}
              </Space>
            ),
          },
          {
            title: '路径',
            dataIndex: 'path',
            render: (_, row) => (
              <Input
                aria-label={`字段路径 ${row.field}`}
                value={row.path}
                className="full-width-control"
                list={pathListId(title, row.id)}
                placeholder="选择 row/context/metrics 路径"
                // 字段路径既可能来自当前 Dataset，也可能来自用户刚设计的上游输出；允许自由输入，避免保存成只读模板。
                onChange={(event) => updateRow(row, { path: event.target.value })}
              />
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 72,
            render: (_, row) => (
              <Button danger icon={<DeleteOutlined />} aria-label={`删除映射 ${row.field}`} disabled={lockedBySchema && row.fromSchema} onClick={() => deleteRow(row)} />
            ),
          },
        ]}
      />
      {rows.map((row) => (
        <datalist key={row.id} id={pathListId(title, row.id)}>
          {options.map((option) => (
            <option key={option.value} value={option.value} />
          ))}
        </datalist>
      ))}
      {lockedBySchema ? null : (
        <Button icon={<PlusOutlined />} aria-label={`${title} ${addButtonLabel}`} onClick={addRow}>
          {addButtonLabel}
        </Button>
      )}
    </Space>
  );
}

function schemaToRows(schema: Record<string, unknown> | null | undefined): MappingRow[] {
  const properties = schema && typeof schema.properties === 'object' && schema.properties ? schema.properties as Record<string, unknown> : {};
  const required = Array.isArray(schema?.required) ? new Set(schema.required.map(String)) : new Set<string>();
  return Object.entries(properties).map(([field, config]) => ({
    id: field,
    field,
    path: '',
    fromSchema: true,
    required: required.has(field),
    fieldType: schemaPropertyType(config),
  }));
}

function schemaPropertyType(config: unknown): string {
  if (!config || typeof config !== 'object') return '';
  const type = (config as { type?: unknown }).type;
  return typeof type === 'string' ? type : '';
}

function buildSelectOptions(pathOptions: string[], rows: MappingRow[]) {
  return [...new Set([...pathOptions, ...rows.map((row) => row.path).filter(Boolean)])].map((path) => ({ value: path, label: path }));
}

function rowsToMapping(rows: MappingRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((mapping, row) => {
    const field = row.field.trim();
    if (!field) return mapping;
    mapping[field] = row.path;
    return mapping;
  }, {});
}

function uniqueFieldName(rows: MappingRow[]) {
  const existing = new Set(rows.map((row) => row.field));
  let index = rows.length + 1;
  let field = `field_${index}`;
  while (existing.has(field)) {
    index += 1;
    field = `field_${index}`;
  }
  return field;
}

function pathListId(title: string, rowId: string) {
  return `mapping-path-${title}-${rowId}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
}
