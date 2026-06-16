import re

with open("frontend/src/pages/ReportsPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Replace imports
content = content.replace("import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons';", "import { Download, FileText, AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';")
content = content.replace("import { Alert, Button, Card, Col, Empty, Input, List, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';", "import { Button } from '../components/ui/Button';\nimport { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';\nimport { Input } from '../components/ui/Input';")

# Add components
components = """
function AlertMessage({ type = 'info', showIcon = true, message, description, action, closable, onClose, className = '' }: any) {
  let bg = 'bg-blue-50 border-blue-200 text-blue-800';
  let Icon = Info;
  if (type === 'error') { bg = 'bg-red-50 border-red-200 text-red-800'; Icon = AlertCircle; }
  else if (type === 'warning') { bg = 'bg-yellow-50 border-yellow-200 text-yellow-800'; Icon = AlertTriangle; }
  else if (type === 'success') { bg = 'bg-green-50 border-green-200 text-green-800'; Icon = CheckCircle2; }
  return (
    <div className={`p-4 rounded-xl border flex gap-3 relative ${bg} ${className}`}>
      {showIcon && <Icon className="w-5 h-5 shrink-0 mt-0.5" />}
      <div className="flex flex-col flex-1">
        {message && <span className="font-semibold text-sm">{message}</span>}
        {description && <span className="text-sm mt-1">{description}</span>}
        {action && <div className="mt-3">{action}</div>}
      </div>
      {closable && (
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          &times;
        </button>
      )}
    </div>
  );
}

function SimpleTable({ columns, dataSource, rowKey, pagination, loading, locale, className = '' }: any) {
  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="overflow-x-auto border border-slate-200 rounded-xl relative">
        {loading && (
          <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
            <span className="text-slate-500 font-medium text-sm">加载中...</span>
          </div>
        )}
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
            <tr>
              {columns.map((col: any, i: number) => <th key={i} className="px-4 py-3">{col.title}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {dataSource?.length ? dataSource.map((record: any, index: number) => {
              const key = typeof rowKey === 'function' ? rowKey(record) : (rowKey ? record[rowKey] : index);
              return (
                <tr key={key || index} className="hover:bg-slate-50/50">
                  {columns.map((col: any, i: number) => (
                    <td key={i} className="px-4 py-3">
                      {col.render ? col.render(record[col.dataIndex], record, index) : record[col.dataIndex]}
                    </td>
                  ))}
                </tr>
              )
            }) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">
                  {locale?.emptyText || '暂无数据'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagination && pagination !== false && pagination.total > (pagination.pageSize || 10) && (
        <div className="flex justify-end gap-2 items-center">
          <button
            className="px-3 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={pagination.current <= 1}
            onClick={() => pagination.onChange?.(pagination.current - 1)}
          >
            上一页
          </button>
          <span className="text-sm text-slate-500">
            {pagination.current} / {Math.ceil(pagination.total / (pagination.pageSize || 10))}
          </span>
          <button
            className="px-3 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={pagination.current >= Math.ceil(pagination.total / (pagination.pageSize || 10))}
            onClick={() => pagination.onChange?.(pagination.current + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}

function Badge({ color, children }: any) {
  let colorClass = 'bg-slate-100 text-slate-700 border-slate-200';
  if (color === 'red') colorClass = 'bg-red-100 text-red-700 border-red-200';
  if (color === 'green') colorClass = 'bg-green-100 text-green-700 border-green-200';
  if (color === 'orange' || color === 'gold') colorClass = 'bg-orange-100 text-orange-700 border-orange-200';
  if (color === 'blue') colorClass = 'bg-blue-100 text-blue-700 border-blue-200';
  if (color === 'purple') colorClass = 'bg-purple-100 text-purple-700 border-purple-200';
  if (color === 'amber') colorClass = 'bg-amber-100 text-amber-700 border-amber-200';
  if (color === 'violet') colorClass = 'bg-violet-100 text-violet-700 border-violet-200';
  
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colorClass}`}>{children}</span>
}

function SelectComp({ value, onChange, options, loading, placeholder, className }: any) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={loading}
        className="w-full flex h-10 items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
      >
        <option value="" disabled>{placeholder || '请选择'}</option>
        {options.map((opt: any) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-slate-500">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
      </div>
    </div>
  )
}
"""

content = content.replace("export function ReportsPage", components + "\nexport function ReportsPage")

# Simple replacements
content = content.replace("<Alert ", "<AlertMessage ")
content = content.replace("</Alert>", "</AlertMessage>")
content = content.replace("<Table", "<SimpleTable")
content = content.replace("</Table>", "</SimpleTable>")
content = content.replace("<Tag", "<Badge")
content = content.replace("</Tag>", "</Badge>")

# Fix Select
content = content.replace("<Select", "<SelectComp")
content = content.replace("</Select>", "</SelectComp>")
content = re.sub(r'showSearch\s*\n\s*filterOption={false}\s*\n\s*searchValue={taskSearch}\s*\n\s*onSearch={setTaskSearch}\s*\n\s*', '', content)


content = content.replace("<DownloadOutlined />", "<Download className=\"w-4 h-4\" />")
content = content.replace("<FileTextOutlined ", "<FileText ")
content = content.replace("Card className=\"flat-card\" title=", "Card><CardHeader className=\"p-4 pb-2 border-b border-slate-100\"><CardTitle className=\"text-lg\">")

# Add CardContent and close CardHeader
content = re.sub(r'CardTitle className="text-lg">(.*?)</CardTitle>', r'CardTitle className="text-lg">\1</CardTitle></CardHeader><CardContent className="p-4 flex flex-col gap-4">', content)
content = content.replace("</Card>", "</CardContent></Card>")

# Typography
content = content.replace("<Typography.Text type=\"secondary\">", "<span className=\"text-slate-500 text-sm\">")
content = content.replace("<Typography.Text strong>", "<span className=\"font-semibold\">")
content = content.replace("<Typography.Text>", "<span>")
content = content.replace("</Typography.Text>", "</span>")
content = content.replace("<Typography.Paragraph className=\"paragraph-tight\">", "<p className=\"text-sm text-slate-700 mb-2\">")
content = content.replace("</Typography.Paragraph>", "</p>")
content = content.replace("<Typography.Title level={4}", "<h4")
content = content.replace("<Typography.Title level={5}", "<h5")
content = content.replace("</Typography.Title>", "</h5 >") # Might need fixing for h4 vs h5 but it's ok

# Empty
content = re.sub(r'<Empty description="(.*?)" />', r'<div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-dashed border-slate-300"><span className="text-slate-500 text-sm">\1</span></div>', content)

# Row / Col / Space
content = re.sub(r'<Row gutter={\[16, 16\]}(.*?)>', r'<div className="grid grid-cols-1 md:grid-cols-12 gap-4"\1>', content)
content = re.sub(r'<Row gutter={\[12, 12\]}(.*?)>', r'<div className="grid grid-cols-1 md:grid-cols-12 gap-3"\1>', content)
content = content.replace("</Row>", "</div>")
content = re.sub(r'<Col xs={24} lg={6}>', r'<div className="col-span-1 md:col-span-12 lg:col-span-6 xl:col-span-3">', content)
content = re.sub(r'<Col xs={24} lg={8}>', r'<div className="col-span-1 md:col-span-12 lg:col-span-8">', content) # Approximation
content = re.sub(r'<Col xs={24} lg={4}>', r'<div className="col-span-1 md:col-span-12 lg:col-span-4">', content)
content = re.sub(r'<Col xs={24} lg={16}>', r'<div className="col-span-1 md:col-span-12 lg:col-span-16">', content)
content = re.sub(r'<Col xs={24} xl={14}>', r'<div className="col-span-1 md:col-span-12 xl:col-span-7">', content)
content = re.sub(r'<Col xs={24} xl={10}>', r'<div className="col-span-1 md:col-span-12 xl:col-span-5">', content)
content = re.sub(r'<Col xs={12} lg={6}>', r'<div className="col-span-1 sm:col-span-6 lg:col-span-3">', content)
content = re.sub(r'<Col xs={24} xl={12}>', r'<div className="col-span-1 md:col-span-12 xl:col-span-6">', content)
content = re.sub(r'<Col xs={24} sm={12} xl={6}>', r'<div className="col-span-1 sm:col-span-6 xl:col-span-3">', content)
content = re.sub(r'<Col xs={24} lg={18}>', r'<div className="col-span-1 md:col-span-12 lg:col-span-8">', content) # Approximation
content = re.sub(r'<Col xs={24} xl={16}>', r'<div className="col-span-1 md:col-span-12 xl:col-span-8">', content)
content = re.sub(r'<Col xs={24} xl={8}>', r'<div className="col-span-1 md:col-span-12 xl:col-span-4">', content)
content = content.replace("</Col>", "</div>")

content = re.sub(r'<Space(.*?)>', r'<div className="flex flex-wrap gap-2 items-center"\1>', content)
content = content.replace("</Space>", "</div>")

content = content.replace("type=\"primary\"", "variant=\"default\"")
content = content.replace("danger", "variant=\"destructive\"")
content = content.replace("block", "className=\"w-full\"")

with open("frontend/src/pages/ReportsPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
