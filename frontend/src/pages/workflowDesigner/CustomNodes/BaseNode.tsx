import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Play, CheckCircle2, AlertCircle, AlertTriangle, Cpu, Zap, Activity } from 'lucide-react';
import { cn } from '../../../lib/utils';
import './BaseNode.css';

export interface PortConfig {
  id: string;
  label: string;
  type: 'input' | 'output';
}

export interface BaseNodeData extends Record<string, unknown> {
  label: string;
  subtitle?: string;
  nodeType: string;
  status?: 'idle' | 'running' | 'success' | 'error' | 'warning';
  icon?: ReactNode;
  color?: string;
  gradient?: string;
  inputs?: PortConfig[];
  outputs?: PortConfig[];
  metrics?: {
    latency?: string;
    tokens?: string;
    cached?: boolean;
  };
  error?: string;
  graphNode?: any;
}

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case 'running':
      return <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}><Activity className="w-3 h-3 text-blue-500" /></motion.div>;
    case 'success':
      return <CheckCircle2 className="w-3 h-3 text-emerald-500" />;
    case 'error':
      return <AlertCircle className="w-3 h-3 text-rose-500" />;
    case 'warning':
      return <AlertTriangle className="w-3 h-3 text-amber-500" />;
    default:
      return <div className="w-2 h-2 rounded-full bg-slate-300" />;
  }
};

const statusGlow = {
  idle: '',
  running: 'ring-2 ring-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]',
  success: 'ring-1 ring-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]',
  error: 'ring-2 ring-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]',
  warning: 'ring-1 ring-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.2)]',
};

export const BaseNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as BaseNodeData;
  const { label, subtitle, status = 'idle', icon, color = 'bg-blue-500', gradient, inputs, outputs, metrics, error } = nodeData;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cn(
        "relative min-w-[280px] max-w-[340px] bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col transition-all duration-200",
        selected ? "ring-2 ring-indigo-500 shadow-md scale-[1.02]" : "hover:shadow-md",
        statusGlow[status]
      )}
      style={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderWidth: 1, borderStyle: 'solid' }}
    >
      {/* 顶部彩色装饰线 */}
      <div className={cn("absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-80", gradient || color)} />

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 pt-4 border-b border-slate-100">
        <div className={cn("flex items-center justify-center w-8 h-8 rounded-xl shrink-0 text-white shadow-sm", gradient || color)}>
          {icon || <Cpu className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-sm font-semibold text-slate-800 truncate tracking-tight">{label}</span>
          {subtitle && <span className="text-[11px] text-slate-500 truncate">{subtitle}</span>}
        </div>
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-50 shrink-0">
          <StatusIcon status={status} />
        </div>
      </div>

      {/* Ports Area */}
      <div className="flex flex-col py-2 relative bg-white">
        {inputs?.map((port) => (
          <div key={port.id} className="relative flex items-center px-4 py-1.5 min-h-[28px] group hover:bg-slate-50 transition-colors">
            <Handle
              type="target"
              position={Position.Left}
              id={port.id}
              className={cn(
                "!w-3 !h-3 !bg-white !border-2 !border-slate-300 !rounded-full transition-all group-hover:!border-indigo-500 group-hover:!bg-indigo-50 group-hover:scale-110",
                "!left-[-6px]"
              )}
            />
            <span className="text-[11px] font-medium text-slate-600">{port.label}</span>
          </div>
        ))}

        {inputs && inputs.length > 0 && outputs && outputs.length > 0 && (
          <div className="h-px bg-slate-100 mx-4 my-1" />
        )}

        {outputs?.map((port) => (
          <div key={port.id} className="relative flex items-center justify-end px-4 py-1.5 min-h-[28px] group hover:bg-slate-50 transition-colors">
            <span className="text-[11px] font-medium text-slate-600">{port.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              className={cn(
                "!w-3 !h-3 !bg-white !border-2 !border-slate-300 !rounded-full transition-all group-hover:!border-indigo-500 group-hover:!bg-indigo-50 group-hover:scale-110",
                "!right-[-6px]"
              )}
            />
          </div>
        ))}
      </div>

      {/* Metrics / Footer */}
      {(metrics || error) && (
        <div className="px-4 py-3 bg-slate-50/50 border-t border-slate-100 rounded-b-2xl flex flex-col gap-2">
          {metrics && (
            <div className="flex flex-wrap gap-2">
              {metrics.latency && <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200"><Zap className="w-3 h-3 mr-1"/>{metrics.latency}</span>}
              {metrics.tokens && <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">{metrics.tokens}</span>}
              {metrics.cached && <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">cached</span>}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-1.5 p-2 bg-rose-50 border border-rose-100 rounded-lg text-rose-600 text-[11px] leading-relaxed">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
});

BaseNode.displayName = 'BaseNode';
