import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CloudUpload, 
  Database, 
  Network,
  Wand2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileJson,
  X,
  Activity,
  Code
} from 'lucide-react';

import { api, formatApiError } from '../api/client';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/Dialog';
import type { DatasetQualityDiagnosis, DatasetVersion } from '../types';

export function DatasetsPage() {
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [materializeOpen, setMaterializeOpen] = useState(false);
  
  // Custom file state instead of Antd's UploadFile
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  
  const [uploadForm, setUploadForm] = useState({ name: '', golden: false, label_field: '', answer_field: '' });
  const [materializeForm, setMaterializeForm] = useState({
    name: 'source_materialized_dataset',
    rows: JSON.stringify([{ question: '示例问题', reference: '示例答案', expected_label: 'pass' }], null, 2),
    label_field: 'expected_label',
    golden: true,
  });

  const [activeDataset, setActiveDataset] = useState<DatasetVersion | null>(null);
  const [lineageDataset, setLineageDataset] = useState<DatasetVersion | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [searchParams] = useSearchParams();

  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.datasets });
  const lineageQuery = useQuery({
    queryKey: ['dataset-lineage', lineageDataset?.dataset_id, lineageDataset?.version],
    queryFn: () => api.datasetLineage(lineageDataset?.dataset_id ?? '', lineageDataset?.version ?? 0),
    enabled: Boolean(lineageDataset),
  });
  
  const datasetVersions = useMemo(() => datasetsQuery.data?.flatMap((dataset) => dataset.versions) ?? [], [datasetsQuery.data]);

  useEffect(() => {
    const targetDatasetId = searchParams.get('dataset_id');
    const targetVersion = Number(searchParams.get('version') ?? 0);
    if (!targetDatasetId || !targetVersion) return;
    const matched = datasetVersions.find((dataset) => dataset.dataset_id === targetDatasetId && dataset.version === targetVersion);
    if (matched && activeDataset?.version_id !== matched.version_id) {
      setActiveDataset(matched);
    }
  }, [activeDataset?.version_id, datasetVersions, searchParams]);

  const previewDataset = activeDataset ?? datasetVersions[0] ?? null;
  const qualityQuery = useQuery({
    queryKey: ['dataset-quality', previewDataset?.dataset_id, previewDataset?.version],
    queryFn: () => api.datasetQuality(previewDataset?.dataset_id ?? '', previewDataset?.version ?? 0),
    enabled: Boolean(previewDataset),
  });

  const previewRows = previewDataset
    ? Object.entries(previewDataset.field_schema).map(([field, type]) => ({
        key: field,
        path: `row.${field}`,
        type,
        example: String(previewDataset.preview[0]?.[field] ?? ''),
      }))
    : [];

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error('请先选择 CSV 或 JSONL 文件');
      if (!uploadForm.name) throw new Error('请输入数据集名称');
      
      const content = await readFileText(uploadFile);
      return api.uploadDataset({
        name: uploadForm.name,
        filename: uploadFile.name,
        content,
        golden: uploadForm.golden,
        label_field: uploadForm.label_field || undefined,
        answer_field: uploadForm.answer_field || undefined,
      });
    },
    onSuccess: async (dataset) => {
      setActiveDataset(dataset);
      setNotice({ type: 'success', message: `上传成功：${dataset.name} v${dataset.version}，共 ${dataset.row_count} 行。` });
      setUploadOpen(false);
      setUploadFile(null);
      setUploadForm({ name: '', golden: false, label_field: '', answer_field: '' });
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
    },
    onError: (error) => setNotice({ type: 'error', message: `上传失败：${formatApiError(error)}` }),
  });

  const materializeMutation = useMutation({
    mutationFn: async () => {
      if (!materializeForm.name) throw new Error('请输入数据集名称');
      const rows = JSON.parse(materializeForm.rows) as Record<string, unknown>[];
      if (!Array.isArray(rows)) throw new Error('Source rows 必须是数组');
      return api.materializeSource({
        name: materializeForm.name,
        rows,
        golden: materializeForm.golden,
        label_field: materializeForm.label_field || undefined,
      });
    },
    onSuccess: async (dataset) => {
      setActiveDataset(dataset);
      setNotice({ type: 'success', message: `物化成功：${dataset.name} v${dataset.version}，字段路径已生成。` });
      setMaterializeOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
    },
    onError: (error) => setNotice({ type: 'error', message: `物化失败：${formatApiError(error)}` }),
  });

  const repairVersionMutation = useMutation({
    mutationFn: () => {
      if (!previewDataset) throw new Error('请选择需要修复的数据集版本。');
      return api.repairDatasetVersion(previewDataset.dataset_id, previewDataset.version, {
        drop_duplicate_rows: true,
        fill_missing: buildDefaultMissingValues(qualityQuery.data),
        reason: '根据字段治理诊断生成修复版 Dataset Version。',
      });
    },
    onSuccess: async (dataset) => {
      setActiveDataset(dataset);
      setNotice({ type: 'success', message: `已生成修复版 Dataset Version：${dataset.version_id}，共 ${dataset.row_count} 行。` });
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
      await queryClient.invalidateQueries({ queryKey: ['dataset-quality'] });
    },
    onError: (error) => setNotice({ type: 'error', message: `生成修复版失败：${formatApiError(error)}` }),
  });

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      setUploadFile(file);
      setUploadForm(prev => ({ ...prev, name: file.name.replace(/\.(csv|jsonl)$/i, '') }));
      setUploadOpen(true);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      setUploadForm(prev => ({ ...prev, name: file.name.replace(/\.(csv|jsonl)$/i, '') }));
      setUploadOpen(true);
    }
  };

  return (
    <div className="pb-10 max-w-7xl mx-auto">
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`mb-6 p-4 rounded-2xl border flex items-start gap-3 shadow-sm ${
              notice.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-800'
            }`}
          >
            {notice.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> : <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
            <div className="font-medium flex-1 pt-0.5">{notice.message}</div>
            <button onClick={() => setNotice(null)} className="p-1 rounded-lg hover:bg-black/5 transition-colors">
              <X className="w-4 h-4 opacity-50" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-gradient-to-br from-slate-800 via-slate-900 to-slate-900 rounded-[2rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] p-8 md:p-10 mb-8 relative overflow-hidden">
        <div className="absolute -top-32 -right-32 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-slate-500/20 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col lg:flex-row gap-10">
          <div className="w-full lg:w-1/3 flex flex-col">
            <div className="flex items-center gap-4 mb-5">
              <div className="p-4 bg-slate-700/50 rounded-2xl text-blue-400 shadow-inner border border-slate-600/50">
                <Database className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">数据中心</h2>
                <p className="text-slate-400 text-sm mt-1">构建与管理评测集与 Golden 标签</p>
              </div>
            </div>
            
            <div className="mt-auto">
              <label className="text-white font-semibold text-sm mb-2 block">活跃数据版本</label>
              <div className="relative">
                <select 
                  className="w-full appearance-none bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={previewDataset?.version_id ?? ''}
                  onChange={(e) => setActiveDataset(datasetVersions.find((item) => item.version_id === e.target.value) ?? null)}
                >
                  {datasetVersions.map(d => (
                    <option key={d.version_id} value={d.version_id}>{d.name} v{d.version}</option>
                  ))}
                  {datasetVersions.length === 0 && <option value="">暂无数据集</option>}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mt-6">
                <Button onClick={() => setUploadOpen(true)} className="bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20 border-none rounded-xl">
                  <CloudUpload className="w-4 h-4 mr-2" /> 新版本
                </Button>
                <Button variant="outline" onClick={() => setMaterializeOpen(true)} className="bg-slate-800/50 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 rounded-xl">
                  <Code className="w-4 h-4 mr-2" /> 虚拟物化
                </Button>
                <Button variant="outline" onClick={() => setLineageDataset(previewDataset)} disabled={!previewDataset} className="bg-transparent border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl">
                  <Network className="w-4 h-4 mr-2" /> 血缘
                </Button>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-2/3">
            <label 
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="cursor-pointer group flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-sm border-2 border-dashed border-slate-700 hover:border-blue-500 hover:bg-slate-800/50 transition-all rounded-[2rem] h-full py-16 px-6 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <CloudUpload className="w-8 h-8 text-blue-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-2">拖拽 CSV 或 JSONL 文件至此</h3>
              <p className="text-slate-400 text-sm max-w-sm">点击或拖拽文件进行上传。上传后将自动推断字段类型并进行数据质量扫描。</p>
              <input type="file" className="hidden" accept=".csv,.jsonl" onChange={handleFileInput} />
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Fields Preview */}
        <Card className="flex flex-col p-8 shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-800">字段推断预览</h3>
              <p className="text-slate-500 text-sm mt-1">检查数据集的键名和自动推断的数据类型</p>
            </div>
          </div>
          
          <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
            {previewRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-3 px-4 font-medium">路径</th>
                      <th className="py-3 px-4 font-medium">类型</th>
                      <th className="py-3 px-4 font-medium">示例</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={row.key} className={i !== previewRows.length - 1 ? "border-b border-slate-100" : ""}>
                        <td className="py-3 px-4"><code className="bg-white px-2 py-1 rounded-md text-xs font-mono text-slate-700 border shadow-sm">{row.path}</code></td>
                        <td className="py-3 px-4"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">{row.type}</span></td>
                        <td className="py-3 px-4"><div className="truncate max-w-[200px] text-slate-600" title={row.example}>{row.example}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center flex flex-col items-center">
                <Database className="w-10 h-10 text-slate-300 mb-3" />
                <p className="text-slate-500 font-medium">暂无数据</p>
                <p className="text-slate-400 text-sm">请先选择或上传数据集</p>
              </div>
            )}
          </div>
        </Card>

        {/* Quality Diagnosis */}
        <Card className="flex flex-col p-8 shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-800">质量诊断与治理</h3>
              <p className="text-slate-500 text-sm mt-1">检测字段缺失、重复样本并生成修复版</p>
            </div>
            <Button
              disabled={!previewDataset || !qualityQuery.data || repairVersionMutation.isPending}
              onClick={() => repairVersionMutation.mutate()}
              className="bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-500/20"
            >
              <Wand2 className="w-4 h-4 mr-2" /> 生成修复版
            </Button>
          </div>

          <div className="flex-1">
            {previewDataset && qualityQuery.data ? (
              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-slate-50 rounded-2xl p-4 text-center border border-slate-100">
                    <div className="text-slate-500 text-xs font-semibold mb-1 uppercase tracking-wider">总样本数</div>
                    <div className="text-2xl font-bold text-slate-800">{qualityQuery.data.summary.row_count}</div>
                  </div>
                  <div className="bg-orange-50 rounded-2xl p-4 text-center border border-orange-100">
                    <div className="text-orange-600/80 text-xs font-semibold mb-1 uppercase tracking-wider">缺失字段</div>
                    <div className="text-2xl font-bold text-orange-600">{qualityQuery.data.summary.fields_with_missing}</div>
                  </div>
                  <div className="bg-red-50 rounded-2xl p-4 text-center border border-red-100">
                    <div className="text-red-600/80 text-xs font-semibold mb-1 uppercase tracking-wider">重复样本</div>
                    <div className="text-2xl font-bold text-red-600">{qualityQuery.data.summary.duplicate_row_count}</div>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-2xl border border-slate-100 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-3 px-4 font-medium">路径</th>
                        <th className="py-3 px-4 font-medium">覆盖率</th>
                        <th className="py-3 px-4 font-medium">缺失数</th>
                        <th className="py-3 px-4 font-medium">建议</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qualityQuery.data.fields.slice(0, 5).map((field, i) => (
                        <tr key={field.field} className={i !== 4 ? "border-b border-slate-100" : ""}>
                          <td className="py-3 px-4"><code className="bg-white px-2 py-1 rounded text-xs font-mono text-slate-700 shadow-sm border border-slate-100">{field.path}</code></td>
                          <td className="py-3 px-4 font-semibold text-slate-700">{formatPercent(field.coverage_rate)}</td>
                          <td className="py-3 px-4">
                            <span className={field.missing_count > 0 ? "text-red-500 font-bold" : "text-slate-400"}>{field.missing_count}</span>
                          </td>
                          <td className="py-3 px-4">
                            {field.recommendation.action !== 'none' ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-orange-100 text-orange-800">{field.recommendation.message}</span>
                            ) : (
                              <span className="text-xs text-slate-400">良好</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[240px] flex flex-col items-center justify-center bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2rem]">
                <Activity className="w-10 h-10 text-slate-300 mb-3" />
                <p className="text-slate-500 font-medium">等待诊断分析</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记新数据集版本</DialogTitle>
          </DialogHeader>
          <div className="py-4 flex flex-col gap-4">
            {uploadFile && (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-3">
                <FileJson className="w-6 h-6 text-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-blue-900 truncate">{uploadFile.name}</div>
                  <div className="text-xs text-blue-600">{(uploadFile.size / 1024).toFixed(1)} KB</div>
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1.5 block">数据集名称</label>
              <Input 
                value={uploadForm.name} 
                onChange={(e) => setUploadForm(p => ({ ...p, name: e.target.value }))} 
                placeholder="例如: evaluation_set_v1" 
              />
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="golden-check" 
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={uploadForm.golden}
                onChange={(e) => setUploadForm(p => ({ ...p, golden: e.target.checked }))}
              />
              <label htmlFor="golden-check" className="text-sm font-medium text-slate-700">标记为 Golden Dataset</label>
            </div>
            {uploadForm.golden && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex flex-col gap-4 overflow-hidden">
                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Golden 标签字段名</label>
                  <Input 
                    value={uploadForm.label_field} 
                    onChange={(e) => setUploadForm(p => ({ ...p, label_field: e.target.value }))} 
                    placeholder="例如: expected_label" 
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-1.5 block">参考答案字段名</label>
                  <Input 
                    value={uploadForm.answer_field} 
                    onChange={(e) => setUploadForm(p => ({ ...p, answer_field: e.target.value }))} 
                    placeholder="例如: reference_answer" 
                  />
                </div>
              </motion.div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>取消</Button>
            <Button disabled={!uploadFile || !uploadForm.name || uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>
              {uploadMutation.isPending ? '上传中...' : '开始上传'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Materialize Dialog */}
      <Dialog open={materializeOpen} onOpenChange={setMaterializeOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>代码块虚拟物化</DialogTitle>
          </DialogHeader>
          <div className="py-4 flex flex-col gap-4">
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1.5 block">物化名称</label>
              <Input 
                value={materializeForm.name} 
                onChange={(e) => setMaterializeForm(p => ({ ...p, name: e.target.value }))} 
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1.5 block">数据结构 (JSON)</label>
              <textarea 
                className="w-full h-48 rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={materializeForm.rows}
                onChange={(e) => setMaterializeForm(p => ({ ...p, rows: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="golden-mat-check" 
                className="rounded border-slate-300 text-blue-600"
                checked={materializeForm.golden}
                onChange={(e) => setMaterializeForm(p => ({ ...p, golden: e.target.checked }))}
              />
              <label htmlFor="golden-mat-check" className="text-sm font-medium text-slate-700">标记为 Golden Dataset</label>
            </div>
            {materializeForm.golden && (
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Golden 标签字段名</label>
                <Input 
                  value={materializeForm.label_field} 
                  onChange={(e) => setMaterializeForm(p => ({ ...p, label_field: e.target.value }))} 
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMaterializeOpen(false)}>取消</Button>
            <Button disabled={!materializeForm.name || materializeMutation.isPending} onClick={() => materializeMutation.mutate()}>
              {materializeMutation.isPending ? '执行中...' : '提交物化'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
    </div>
  );
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${(value * 100).toFixed(1)}%`;
}

function buildDefaultMissingValues(quality?: DatasetQualityDiagnosis): Record<string, unknown> {
  if (!quality) return {};
  return Object.fromEntries(
    quality.fields
      .filter((field) => field.missing_count > 0 && field.recommendation.action === 'fill_missing')
      .map((field) => [field.field, field.recommendation.default_value ?? defaultMissingValue(field.type)]),
  );
}

function defaultMissingValue(fieldType: string): unknown {
  if (fieldType === 'number') return 0;
  if (fieldType === 'boolean') return false;
  if (fieldType === 'json') return {};
  return '待补充';
}
