import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Cpu, Zap, Activity, Settings } from 'lucide-react';
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
    latency?: number;
    total_tokens?: number;
    cost?: number;
    cached?: boolean;
  };
  error?: string;
  graphNode?: any;
}

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case 'running':
      return <Activity className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
    case 'success':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    case 'error':
      return <AlertCircle className="w-3.5 h-3.5 text-rose-500" />;
    case 'warning':
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
    default:
      return <div className="w-2 h-2 rounded-full bg-slate-300" />;
  }
};

export const BaseNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as BaseNodeData;
  const { label, subtitle, status = 'idle', icon, color = '#3b82f6', gradient, inputs, outputs, metrics, error } = nodeData;

  return (
    <div className={`aegis-node-card ${selected ? 'selected' : ''}`}>
      {/* 顶部优雅的彩色饰条 */}
      <div 
        className="aegis-node-decor" 
        style={{ background: gradient || color || '#e2e8f0' }} 
      />
      
      {/* Header 区域 */}
      <div className="aegis-node-header">
        <div 
          className="aegis-node-icon" 
          style={{ 
            color: color || '#64748b',
            backgroundColor: color ? `${color}1A` : '#f1f5f9' 
          }}
        >
          {icon || <Settings className="w-4 h-4" />}
        </div>
        <div className="aegis-node-title-group">
          <div className="aegis-node-title" title={label}>{label}</div>
          {subtitle && <div className="aegis-node-subtitle" title={subtitle}>{subtitle}</div>}
        </div>
        <StatusIcon status={status} />
      </div>

      {/* Body / Ports Area */}
      <div className="aegis-node-body">
        {/* 输入端点 */}
        {inputs?.map((port) => (
          <div key={port.id} className="aegis-node-port-row">
            <Handle
              type="target"
              position={Position.Left}
              id={port.id}
              className="aegis-handle input"
            />
            <span className="aegis-node-port-label">{port.label}</span>
          </div>
        ))}

        {/* 分隔线（当同时存在输入和输出时） */}
        {inputs && inputs.length > 0 && outputs && outputs.length > 0 && (
          <div style={{ height: '1px', backgroundColor: '#f1f5f9', margin: '4px 14px' }} />
        )}

        {/* 输出端点 */}
        {outputs?.map((port) => (
          <div key={port.id} className="aegis-node-port-row" style={{ justifyContent: 'flex-end' }}>
            <span className="aegis-node-port-label">{port.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              className="aegis-handle output"
            />
          </div>
        ))}
      </div>

      {/* Footer / Metrics & Errors */}
      {(metrics || error) && (
        <div className="aegis-node-footer">
          {metrics && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {metrics?.latency !== undefined && (
                <span style={{ fontSize: '11px', color: '#64748b', backgroundColor: '#ffffff', padding: '2px 8px', borderRadius: '99px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center' }}>
                  ⏱ {metrics.latency.toFixed(2)}s
                </span>
              )}
              {metrics?.total_tokens !== undefined && (
                <span style={{ fontSize: '11px', color: '#64748b', backgroundColor: '#ffffff', padding: '2px 8px', borderRadius: '99px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center' }}>
                  🪙 {metrics.total_tokens} tk
                </span>
              )}
              {metrics?.cost !== undefined && (
                <span style={{ fontSize: '11px', color: '#64748b', backgroundColor: '#ffffff', padding: '2px 8px', borderRadius: '99px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center' }}>
                  💰 ${metrics.cost.toFixed(4)}
                </span>
              )}
            </div>
          )}
          {error && (
            <div style={{ width: '100%', fontSize: '11px', color: '#ef4444', backgroundColor: '#fee2e2', padding: '6px', borderRadius: '6px', marginTop: '4px', display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ marginTop: '1px' }} />
              <span style={{ wordBreak: 'break-word' }}>{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

BaseNode.displayName = 'BaseNode';
