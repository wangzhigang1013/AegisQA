import { beforeEach, describe, expect, it, vi } from 'vitest';

const echartsModuleLoaded = vi.hoisted(() => vi.fn());

vi.mock('echarts-for-react', () => {
  echartsModuleLoaded();
  return { default: () => <div data-testid="echarts">图表模块</div> };
});

describe('图表组件懒加载', () => {
  beforeEach(() => {
    vi.resetModules();
    echartsModuleLoaded.mockClear();
  });

  it('导入报告中心页面时不应立即加载 ECharts 模块', async () => {
    await import('../pages/ReportsPage');

    expect(echartsModuleLoaded).not.toHaveBeenCalled();
  }, 60_000);

  it('导入 Judge 审计页面时不应立即加载 ECharts 模块', async () => {
    await import('../pages/JudgeAuditPage');

    expect(echartsModuleLoaded).not.toHaveBeenCalled();
  });
});
