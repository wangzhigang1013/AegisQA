import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, type ReactNode } from 'react';

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

const statusConfig = {
  idle: { color: '#94a3b8', bg: '#f1f5f9', label: '待执行' },
  running: { color: '#3b82f6', bg: '#eff6ff', label: '运行中' },
  success: { color: '#22c55e', bg: '#f0fdf4', label: '成功' },
  error: { color: '#ef4444', bg: '#fef2f2', label: '失败' },
  warning: { color: '#f59e0b', bg: '#fffbeb', label: '警告' },
};

export const BaseNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as BaseNodeData;
  const { label, subtitle, status, icon, color = '#3b82f6', gradient = 'linear-gradient(135deg, #3b82f6, #6366f1)', inputs, outputs, metrics, error } = nodeData;
  const statusInfo = status ? statusConfig[status as keyof typeof statusConfig] : null;

  return (
    <div
      className={`base-node ${selected ? 'selected' : ''} ${status || ''}`}
      style={{ '--node-color': color, '--node-gradient': gradient } as React.CSSProperties}
    >
      {/* 左侧彩色条 */}
      <div className="node-accent" />

      {/* 输入端口 */}
      {inputs?.map((port, index) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          className="node-handle input-handle"
          style={{ top: `${56 + index * 28}px` }}
        />
      ))}

      {/* 节点内容 */}
      <div className="node-body">
        {/* 标题栏 */}
        <div className="node-header">
          <div className="node-icon-wrapper" style={{ background: gradient }}>
            {icon}
          </div>
          <div className="node-title-group">
            <div className="node-title">{label}</div>
            {subtitle && <div className="node-subtitle">{subtitle}</div>}
          </div>
        </div>

        {/* 端口标签 */}
        <div className="node-ports">
          {inputs && inputs.length > 0 && (
            <div className="port-list input-ports">
              {inputs.map((port) => (
                <div key={port.id} className="port-item">
                  <span className="port-dot input" />
                  <span className="port-label">{port.label}</span>
                </div>
              ))}
            </div>
          )}
          {outputs && outputs.length > 0 && (
            <div className="port-list output-ports">
              {outputs.map((port) => (
                <div key={port.id} className="port-item">
                  <span className="port-label">{port.label}</span>
                  <span className="port-dot output" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 状态栏 */}
        {(statusInfo || metrics) && (
          <div className="node-footer">
            {statusInfo && (
              <div className="node-status" style={{ color: statusInfo.color, background: statusInfo.bg }}>
                {status === 'running' && <span className="status-spinner" />}
                {status === 'success' && <span className="status-icon">✓</span>}
                {status === 'error' && <span className="status-icon">✗</span>}
                {statusInfo.label}
              </div>
            )}
            {metrics && (
              <div className="node-metrics">
                {metrics.latency && <span className="metric">{metrics.latency}</span>}
                {metrics.tokens && <span className="metric">{metrics.tokens}</span>}
                {metrics.cached && <span className="metric cached">cached</span>}
              </div>
            )}
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <div className="node-error">
            <span className="error-icon">!</span>
            <span className="error-text">{error}</span>
          </div>
        )}
      </div>

      {/* 输出端口 */}
      {outputs?.map((port, index) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          className="node-handle output-handle"
          style={{ top: `${56 + index * 28}px` }}
        />
      ))}
    </div>
  );
});

BaseNode.displayName = 'BaseNode';
