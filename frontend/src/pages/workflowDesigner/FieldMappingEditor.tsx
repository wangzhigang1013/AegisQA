import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Input, Space, Table, Typography } from 'antd';

type MappingRow = {
  id: string;
  field: string;
  path: string;
};

type FieldMappingEditorProps = {
  title: string;
  value: Record<string, string>;
  pathOptions: string[];
  onChange: (value: Record<string, string>) => void;
  addButtonLabel?: string;
};

export function FieldMappingEditor({ title, value, pathOptions, onChange, addButtonLabel = '新增映射' }: FieldMappingEditorProps) {
  const rows = Object.entries(value ?? {}).map(([field, path]) => ({ id: field, field, path }));
  const options = buildSelectOptions(pathOptions, rows);

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
        <Typography.Text type="secondary">从 row、context、metrics 中选择字段路径，避免手写 JSON 出错。</Typography.Text>
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
              <Input
                aria-label={`映射字段 ${row.field}`}
                value={row.field}
                onChange={(event) => updateRow(row, { field: event.target.value })}
                placeholder="例如 question"
              />
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
              <Button danger icon={<DeleteOutlined />} aria-label={`删除映射 ${row.field}`} onClick={() => deleteRow(row)} />
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
      <Button icon={<PlusOutlined />} aria-label={`${title} ${addButtonLabel}`} onClick={addRow}>
        {addButtonLabel}
      </Button>
    </Space>
  );
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
