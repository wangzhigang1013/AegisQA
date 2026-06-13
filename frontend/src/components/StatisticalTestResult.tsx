import { Badge, Card, Descriptions, Progress, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';

const { Text } = Typography;

export interface StatisticalTestResultProps {
  testName: string;
  metricName: string;
  groupAName: string;
  groupBName: string;
  groupAMean: number;
  groupBMean: number;
  groupAStd?: number;
  groupBStd?: number;
  groupAN: number;
  groupBN: number;
  statistic: number;
  pValue: number;
  effectSize?: number;
  confidenceInterval?: [number, number];
  isSignificant: boolean;
  significanceLevel?: number;
  recommendation?: string;
}

export function StatisticalTestResult({
  testName,
  metricName,
  groupAName,
  groupBName,
  groupAMean,
  groupBMean,
  groupAStd,
  groupBStd,
  groupAN,
  groupBN,
  statistic,
  pValue,
  effectSize,
  confidenceInterval,
  isSignificant,
  significanceLevel = 0.05,
  recommendation,
}: StatisticalTestResultProps) {
  const pValueColor = isSignificant ? 'success' : 'default';
  const effectSizeLabel = effectSize
    ? Math.abs(effectSize) < 0.2
      ? '小'
      : Math.abs(effectSize) < 0.5
        ? '中'
        : '大'
    : '-';

  return (
    <Card className="flat-card" size="small">
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 16 }}>
          {testName} - {metricName}
        </Text>
        <Badge
          count={isSignificant ? '显著' : '不显著'}
          style={{ marginLeft: 8, backgroundColor: isSignificant ? '#52c41a' : '#d9d9d9' }}
        />
      </div>

      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="检验类型">{testName}</Descriptions.Item>
        <Descriptions.Item label="指标">{metricName}</Descriptions.Item>
        <Descriptions.Item label={groupAName}>
          {groupAMean.toFixed(4)} {groupAStd !== undefined ? `± ${groupAStd.toFixed(4)}` : ''} (n={groupAN})
        </Descriptions.Item>
        <Descriptions.Item label={groupBName}>
          {groupBMean.toFixed(4)} {groupBStd !== undefined ? `± ${groupBStd.toFixed(4)}` : ''} (n={groupBN})
        </Descriptions.Item>
        <Descriptions.Item label="统计量">{statistic.toFixed(4)}</Descriptions.Item>
        <Descriptions.Item label="p-value">
          <Tag color={pValueColor}>{pValue.toFixed(6)}</Tag>
        </Descriptions.Item>
        {effectSize !== undefined && (
          <Descriptions.Item label="效应量 (Cohen's d)">
            <Tag>{effectSize.toFixed(4)} ({effectSizeLabel})</Tag>
          </Descriptions.Item>
        )}
        {confidenceInterval && (
          <Descriptions.Item label="置信区间">
            [{confidenceInterval[0].toFixed(4)}, {confidenceInterval[1].toFixed(4)}]
          </Descriptions.Item>
        )}
        <Descriptions.Item label="显著性水平">α = {significanceLevel}</Descriptions.Item>
      </Descriptions>

      {recommendation && (
        <div style={{ marginTop: 16, padding: 12, background: isSignificant ? '#f6ffed' : '#fafafa', borderRadius: 8 }}>
          <Text>{recommendation}</Text>
        </div>
      )}
    </Card>
  );
}

export interface ComparisonSummaryProps {
  metricName: string;
  baselineMean: number;
  compareMean: number;
  improvement: number;
  isSignificant: boolean;
  pValue: number;
}

export function ComparisonSummary({
  metricName,
  baselineMean,
  compareMean,
  improvement,
  isSignificant,
  pValue,
}: ComparisonSummaryProps) {
  const improvementColor = improvement > 0 ? '#52c41a' : improvement < 0 ? '#ff4d4f' : '#d9d9d9';
  const improvementPrefix = improvement > 0 ? '+' : '';

  return (
    <Card className="flat-card" size="small">
      <div style={{ textAlign: 'center' }}>
        <Text type="secondary">{metricName}</Text>
        <div style={{ fontSize: 24, fontWeight: 700, color: improvementColor, margin: '8px 0' }}>
          {improvementPrefix}{(improvement * 100).toFixed(2)}%
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <Text type="secondary">Baseline: {(baselineMean * 100).toFixed(2)}%</Text>
          <Text type="secondary">Compare: {(compareMean * 100).toFixed(2)}%</Text>
        </div>
        <div style={{ marginTop: 8 }}>
          <Tag color={isSignificant ? 'success' : 'default'}>
            {isSignificant ? '显著差异' : '无显著差异'} (p={pValue.toFixed(4)})
          </Tag>
        </div>
      </div>
    </Card>
  );
}

export interface MetricDistributionProps {
  metricName: string;
  groupA: { name: string; values: Record<string, number> };
  groupB: { name: string; values: Record<string, number> };
}

export function MetricDistribution({ metricName, groupA, groupB }: MetricDistributionProps) {
  const allKeys = Array.from(new Set([...Object.keys(groupA.values), ...Object.keys(groupB.values)]));

  return (
    <Card className="flat-card" size="small" title={`${metricName} 分布对比`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <Text strong>{groupA.name}</Text>
          {allKeys.map((key) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <Text>{key}</Text>
              <Text>{groupA.values[key] || 0}</Text>
            </div>
          ))}
        </div>
        <div>
          <Text strong>{groupB.name}</Text>
          {allKeys.map((key) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <Text>{key}</Text>
              <Text>{groupB.values[key] || 0}</Text>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
