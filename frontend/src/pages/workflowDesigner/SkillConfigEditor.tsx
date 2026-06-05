import { Alert, Input, InputNumber, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';

import type { ModelGatewayConnection, SkillManifest } from '../../types';

type SkillConfigEditorProps = {
  skill: SkillManifest | null;
  value: Record<string, unknown>;
  modelConnections?: ModelGatewayConnection[];
  onChange: (value: Record<string, unknown>) => void;
};

type JsonSchemaField = {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
};

export function SkillConfigEditor({ skill, value, modelConnections = [], onChange }: SkillConfigEditorProps) {
  const [jsonError, setJsonError] = useState<string | null>(null);
  const properties = schemaProperties(skill);
  const required = new Set(schemaRequired(skill));
  const entries = Object.entries(properties);

  if (!skill) {
    return <Typography.Text type="secondary">当前节点未绑定 Skill，绑定后会展示可配置参数。</Typography.Text>;
  }

  if (!entries.length) {
    return <Typography.Text type="secondary">当前 Skill 没有声明 config_schema，执行时只使用默认配置。</Typography.Text>;
  }

  function updateField(field: string, nextValue: unknown) {
    setJsonError(null);
    onChange({ ...(value ?? {}), [field]: nextValue });
  }

  return (
    <Space direction="vertical" className="drawer-stack">
      <Space direction="vertical" size={2}>
        <Typography.Text strong>Skill 参数</Typography.Text>
        <Typography.Text type="secondary">这些参数来自 Skill 的 config_schema，会随 Workflow 草稿和任务快照一起冻结。</Typography.Text>
      </Space>
      {jsonError ? <Alert type="error" showIcon message={jsonError} /> : null}
      {entries.map(([field, schema]) => (
        <Space key={field} direction="vertical" size={4} className="drawer-stack">
          <Space wrap>
            <Typography.Text strong>{schema.title || field}</Typography.Text>
            <Tag>{schemaTypeLabel(schema)}</Tag>
            {required.has(field) ? <Tag color="red">必填</Tag> : null}
          </Space>
          {schema.description ? <Typography.Text type="secondary">{schema.description}</Typography.Text> : null}
          {renderConfigControl(field, schema, value?.[field] ?? schema.default, updateField, setJsonError, modelConnections)}
        </Space>
      ))}
    </Space>
  );
}

function renderConfigControl(
  field: string,
  schema: JsonSchemaField,
  value: unknown,
  updateField: (field: string, value: unknown) => void,
  setJsonError: (message: string | null) => void,
  modelConnections: ModelGatewayConnection[],
) {
  if (field === 'model_connection_id') {
    return (
      <Select
        aria-label={`Skill 参数 ${field}`}
        allowClear
        showSearch
        className="full-width-control"
        placeholder="选择模型连接别名"
        value={value == null || value === '' ? undefined : String(value)}
        onChange={(nextValue) => updateField(field, nextValue ?? '')}
        optionFilterProp="label"
        options={modelConnections.map((connection) => ({
          value: connection.connection_id,
          label: `${connection.name || connection.connection_id}（${connection.connection_id}）`,
          disabled: !connection.enabled,
        }))}
      />
    );
  }

  if (schema.enum?.length) {
    return (
      <Select
        aria-label={`Skill 参数 ${field}`}
        className="full-width-control"
        value={value as string | number | boolean | undefined}
        onChange={(nextValue) => updateField(field, nextValue)}
        options={schema.enum.map((item) => ({ value: item as string | number | boolean, label: String(item) }))}
      />
    );
  }

  const type = firstSchemaType(schema.type);
  if (type === 'number' || type === 'integer') {
    return (
      <InputNumber
        aria-label={`Skill 参数 ${field}`}
        className="full-width-control"
        value={typeof value === 'number' ? value : undefined}
        precision={type === 'integer' ? 0 : undefined}
        onChange={(nextValue) => updateField(field, nextValue ?? 0)}
      />
    );
  }

  if (type === 'boolean') {
    return (
      <Select
        aria-label={`Skill 参数 ${field}`}
        className="full-width-control"
        value={Boolean(value)}
        onChange={(nextValue) => updateField(field, nextValue)}
        options={[
          { value: true, label: 'true' },
          { value: false, label: 'false' },
        ]}
      />
    );
  }

  if (type === 'object' || type === 'array') {
    return (
      <Input.TextArea
        aria-label={`Skill 参数 ${field}`}
        rows={3}
        defaultValue={JSON.stringify(value ?? (type === 'array' ? [] : {}), null, 2)}
        onBlur={(event) => {
          try {
            const parsed = JSON.parse(event.target.value || (type === 'array' ? '[]' : '{}'));
            setJsonError(null);
            updateField(field, parsed);
          } catch {
            setJsonError(`Skill 参数 ${field} 必须是合法 JSON。`);
          }
        }}
      />
    );
  }

  return (
    <Input
      aria-label={`Skill 参数 ${field}`}
      value={value == null ? '' : String(value)}
      onChange={(event) => updateField(field, event.target.value)}
    />
  );
}

function schemaProperties(skill: SkillManifest | null): Record<string, JsonSchemaField> {
  const properties = skill?.config_schema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  return properties as Record<string, JsonSchemaField>;
}

function schemaRequired(skill: SkillManifest | null): string[] {
  const required = skill?.config_schema?.required;
  return Array.isArray(required) ? required.filter((item): item is string => typeof item === 'string') : [];
}

function firstSchemaType(type: JsonSchemaField['type']) {
  return Array.isArray(type) ? type[0] : type;
}

function schemaTypeLabel(schema: JsonSchemaField) {
  const type = firstSchemaType(schema.type);
  return type || 'any';
}
