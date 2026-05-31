import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportsPageLoaded = vi.hoisted(() => vi.fn());
const judgePageLoaded = vi.hoisted(() => vi.fn());

vi.mock('../pages/ReportsPage', () => {
  reportsPageLoaded();
  return { ReportsPage: () => <div>报告中心懒加载页面</div> };
});

vi.mock('../pages/JudgeAuditPage', () => {
  judgePageLoaded();
  return { JudgeAuditPage: () => <div>Judge 审计懒加载页面</div> };
});

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

describe('App 路由懒加载', () => {
  beforeEach(() => {
    vi.resetModules();
    reportsPageLoaded.mockClear();
    judgePageLoaded.mockClear();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse([]));
  });

  it('打开概览页时不预加载报告中心和 Judge 图表页面', async () => {
    const { AppShell } = await import('../App');

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(await screen.findByText('概览')).toBeInTheDocument();
    expect(reportsPageLoaded).not.toHaveBeenCalled();
    expect(judgePageLoaded).not.toHaveBeenCalled();
  });

  it('进入报告中心时才加载报告页面模块', async () => {
    const { AppShell } = await import('../App');

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(await screen.findByText('报告中心懒加载页面')).toBeInTheDocument();
    expect(judgePageLoaded).not.toHaveBeenCalled();
  });
});
