import { useState } from 'react';
import { AlertCircle } from 'lucide-react';

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
    return <p className="text-slate-500 text-sm">当前节点未绑定 Skill，绑定后会展示可配置参数。</p>;
  }

  if (!entries.length) {
    return <p className="text-slate-500 text-sm">当前 Skill 没有声明 config_schema，执行时只使用默认配置。</p>;
  }

  function updateField(field: string, nextValue: unknown) {
    setJsonError(null);
    onChange({ ...(value ?? {}), [field]: nextValue });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="font-semibold text-sm">Skill 参数</h4>
        <p className="text-slate-500 text-xs">这些参数来自 Skill 的 config_schema，会随 Workflow 草稿和任务快照一起冻结。</p>
      </div>
      
      {jsonError ? (
        <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded flex items-start gap-2 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{jsonError}</span>
        </div>
      ) : null}
      
      {entries.map(([field, schema]) => (
        <div key={field} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{schema.title || field}</span>
            <span className="px-2 py-0.5 text-xs rounded bg-slate-100 text-slate-600 border border-slate-200">{schemaTypeLabel(schema)}</span>
            {required.has(field) ? <span className="px-2 py-0.5 text-xs rounded bg-red-100 text-red-700">必填</span> : null}
          </div>
          {schema.description ? <p className="text-slate-500 text-xs">{schema.description}</p> : null}
          {renderConfigControl(field, schema, value?.[field] ?? schema.default, updateField, setJsonError, modelConnections)}
        </div>
      ))}
    </div>
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
  const inputClass = "w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white";

  if (field === 'model_connection_id') {
    return (
      <select
        aria-label={`Skill 参数 ${field}`}
        className={inputClass}
        value={value == null || value === '' ? '' : String(value)}
        onChange={(e) => updateField(field, e.target.value)}
      >
        <option value="">选择模型连接别名</option>
        {modelConnections.map((connection) => (
          <option 
            key={connection.connection_id} 
            value={connection.connection_id}
            disabled={!connection.enabled}
          >
            {connection.name || connection.connection_id}（{connection.connection_id}）
          </option>
        ))}
      </select>
    );
  }

  if (schema.enum?.length) {
    return (
      <select
        aria-label={`Skill 参数 ${field}`}
        className={inputClass}
        value={value as string | number | undefined ?? ''}
        onChange={(e) => updateField(field, e.target.value)}
      >
        {value === undefined && <option value="" disabled>请选择</option>}
        {schema.enum.map((item) => (
          <option key={String(item)} value={String(item)}>
            {String(item)}
          </option>
        ))}
      </select>
    );
  }

  const type = firstSchemaType(schema.type);
  if (type === 'number' || type === 'integer') {
    return (
      <input
        type="number"
        step={type === 'integer' ? '1' : 'any'}
        aria-label={`Skill 参数 ${field}`}
        className={inputClass}
        value={value === undefined ? '' : Number(value)}
        onChange={(e) => updateField(field, e.target.value ? Number(e.target.value) : 0)}
      />
    );
  }

  if (type === 'boolean') {
    return (
      <select
        aria-label={`Skill 参数 ${field}`}
        className={inputClass}
        value={value === undefined ? '' : String(Boolean(value))}
        onChange={(e) => updateField(field, e.target.value === 'true')}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (type === 'object' || type === 'array') {
    return (
      <textarea
        aria-label={`Skill 参数 ${field}`}
        rows={3}
        className={`${inputClass} font-mono text-xs`}
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
    <input
      type="text"
      aria-label={`Skill 参数 ${field}`}
      className={inputClass}
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
