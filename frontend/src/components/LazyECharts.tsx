import { lazy, Suspense, type CSSProperties } from 'react';

type LazyEChartsProps = {
  option: unknown;
  style?: CSSProperties;
  className?: string;
};

const ReactECharts = lazy(() => import('echarts-for-react'));

export function LazyECharts(props: LazyEChartsProps) {
  return (
    <Suspense fallback={<div className="chart-loading" role="status">正在加载图表...</div>}>
      <ReactECharts {...props} />
    </Suspense>
  );
}
