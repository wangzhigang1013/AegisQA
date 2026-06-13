import { Card, Statistic, Tag } from 'antd';
import type { ReactNode } from 'react';

type MetricTileProps = {
  title: string;
  value: string | number;
  suffix?: string;
  icon: ReactNode;
  tone: 'blue' | 'green' | 'amber' | 'violet' | 'red';
  note: string;
  className?: string;
};

export function MetricTile({ title, value, suffix, icon, tone, note, className }: MetricTileProps) {
  return (
    <Card className={`metric-tile metric-${tone} ${className ?? ''}`}>
      <div className="metric-topline">
        <span className="metric-icon">{icon}</span>
        <Tag bordered={false}>{note}</Tag>
      </div>
      <Statistic title={title} value={value} suffix={suffix} />
    </Card>
  );
}
