import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';

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
  mode?: 'input' | 'output';
  nodeId?: string;
};

export function FieldMappingEditor({ title, value, pathOptions, onChange, addButtonLabel = '新增映射', schema, description, mode, nodeId }: FieldMappingEditorProps) {
  const isOutputMapping = mode ? mode === 'output' : title.includes('输出');
  const outputReference = (field: string) => `${nodeId || '当前节点'}.${field}`;
  const schemaFields = schemaToRows(schema);
  const schemaFieldSet = new Set(schemaFields.map((row) => row.field));
  const legacyRows: MappingRow[] = Object.entries(value ?? {})
    .filter(([field]) => !schemaFieldSet.has(field))
    .map(([field, path]) => ({ id: field, field, path: isOutputMapping ? outputReference(field) : path, fromSchema: false }));
  const rows: MappingRow[] = [
    ...schemaFields.map((row) => ({ ...row, path: isOutputMapping ? outputReference(row.field) : value?.[row.field] ?? '' })),
    ...legacyRows,
  ];
  const options = buildSelectOptions(pathOptions, rows);
  const lockedBySchema = schemaFields.length > 0;
  const fieldLabel = isOutputMapping ? '输出字段' : '输入字段';
  const requiredLabel = isOutputMapping ? 'Skill 必返输出' : '必填输入';
  const requiredHelp = isOutputMapping
    ? '来自 output_schema.required，表示 Skill handler 必须返回该字段；是否写给下游由“输出写入”决定。'
    : '来自 input_schema.required，发布和执行前必须绑定到数据集字段或上游输出。';
  const firstOutputReference = rows[0] ? outputReference(rows[0].field) : `${nodeId || '节点ID'}.字段`;

  function updateRow(row: MappingRow, patch: Partial<MappingRow>) {
    const nextRow = { ...row, ...patch };
    const nextEntries = rows.map((item) => (item.id === row.id ? nextRow : item));
    onChange(rowsToMapping(nextEntries, isOutputMapping, outputReference));
  }

  function deleteRow(row: MappingRow) {
    onChange(rowsToMapping(rows.filter((item) => item.id !== row.id), isOutputMapping, outputReference));
  }

  function addRow() {
    const nextField = uniqueFieldName(rows);
    onChange({ ...(value ?? {}), [nextField]: isOutputMapping ? outputReference(nextField) : pathOptions[0] ?? '' });
  }

  const listId = `mapping-paths-${nodeId || 'global'}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="font-semibold text-sm">{title}</h4>
        <p className="text-slate-500 text-xs">{description ?? '从 row、context、metrics 中选择字段路径，避免手写 JSON 出错。'}</p>
        {isOutputMapping ? (
          <p className="text-slate-500 text-xs">Skill 必返输出表示 handler 会返回该字段；下游节点直接在输入绑定里选择 {firstOutputReference} 这类路径，不需要手写输出路径。</p>
        ) : null}
        {!isOutputMapping && pathOptions.length > 80 ? (
          <p className="text-slate-500 text-xs">候选路径较多，输入关键词会搜索；下拉只展示最相关的前 80 条，也可以直接手写路径。</p>
        ) : null}
      </div>

      <div className="border rounded-lg overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-700 border-b">
            <tr>
              <th className="px-4 py-2 font-medium w-1/2">字段</th>
              <th className="px-4 py-2 font-medium w-1/2">{isOutputMapping ? '下游引用' : '路径'}</th>
              <th className="px-4 py-2 font-medium w-12 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-500">暂无映射，请新增字段。</td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id}>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{fieldLabel} {row.field}</span>
                      <div className="flex items-center gap-2">
                        {row.required && (
                          <span 
                            title={requiredHelp}
                            className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${isOutputMapping ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'} cursor-help`}
                          >
                            {requiredLabel}
                          </span>
                        )}
                        {row.fieldType && <span className="text-xs text-slate-500">{row.fieldType}</span>}
                      </div>
                      {!row.fromSchema && (
                        <input
                          type="text"
                          aria-label={`映射字段 ${row.field}`}
                          className="mt-1 w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={row.field}
                          onChange={(event) => updateRow(row, { field: event.target.value })}
                          placeholder="例如 question"
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {isOutputMapping ? (
                      <span className="text-slate-600 bg-slate-50 px-2 py-1 rounded border border-slate-100 block break-all">
                        下游引用 {outputReference(row.field)}
                      </span>
                    ) : (
                      <>
                        <input
                          list={listId}
                          type="text"
                          aria-label={`字段路径 ${row.field}`}
                          className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={row.path}
                          onChange={(e) => updateRow(row, { path: e.target.value })}
                          placeholder="搜索或输入 row/context/节点ID.字段"
                        />
                        <datalist id={listId}>
                          {options.map(opt => <option key={opt.value} value={opt.value} />)}
                        </datalist>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-center">
                    <button
                      aria-label={`删除映射 ${row.field}`}
                      disabled={lockedBySchema && row.fromSchema}
                      onClick={() => deleteRow(row)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!lockedBySchema && (
        <Button 
          variant="outline" 
          onClick={addRow}
          className="w-max flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> {addButtonLabel}
        </Button>
      )}
    </div>
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
  const selectedPaths = rows.map((row) => row.path).filter(Boolean);
  return [...new Set([...selectedPaths, ...pathOptions])].slice(0, 80).map((path) => ({ value: path, label: path }));
}

function rowsToMapping(rows: MappingRow[], isOutputMapping: boolean, outputReference: (field: string) => string): Record<string, string> {
  return rows.reduce<Record<string, string>>((mapping, row) => {
    const field = row.field.trim();
    if (!field) return mapping;
    if (!isOutputMapping && !row.path.trim()) return mapping;
    mapping[field] = isOutputMapping ? outputReference(field) : row.path;
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
