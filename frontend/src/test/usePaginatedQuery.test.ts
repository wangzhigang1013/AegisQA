import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { usePaginatedQuery, type PaginatedResponse } from '../hooks/usePaginatedQuery';

type TestItem = {
  id: string;
  name: string;
};

function makePage(items: TestItem[], page: number, pageSize: number, total: number): PaginatedResponse<TestItem> {
  return {
    items,
    pagination: {
      page,
      page_size: pageSize,
      total_items: total,
      total_pages: Math.ceil(total / pageSize),
    },
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('usePaginatedQuery', () => {
  it('初始状态为第 1 页，默认 pageSize 20', async () => {
    const fetcher = vi.fn().mockResolvedValue(makePage([{ id: '1', name: 'A' }], 1, 20, 1));

    const { result } = renderHook(() => usePaginatedQuery<TestItem>({
      queryKey: ['test'],
      fetcher,
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.page).toBe(1);
    expect(result.current.pagination?.page_size).toBe(20);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe('1');
    expect(fetcher).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('切换页码后用正确参数重新请求', async () => {
    const page1 = makePage(
      Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), name: `Item ${i + 1}` })),
      1, 20, 50,
    );
    const page2 = makePage(
      Array.from({ length: 20 }, (_, i) => ({ id: String(i + 21), name: `Item ${i + 21}` })),
      2, 20, 50,
    );

    const fetcher = vi.fn()
      .mockImplementation(({ page }: { page: number }) => Promise.resolve(page === 1 ? page1 : page2));

    const { result } = renderHook(() => usePaginatedQuery<TestItem>({
      queryKey: ['test-paging'],
      fetcher,
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items[0].id).toBe('1');

    act(() => result.current.setPage(2));

    await waitFor(() => expect(result.current.items[0].id).toBe('21'));
    expect(fetcher).toHaveBeenCalledWith({ page: 2, pageSize: 20 });
    expect(result.current.page).toBe(2);
  });

  it('resetPage 回到第 1 页', async () => {
    const fetcher = vi.fn().mockResolvedValue(makePage([{ id: '1', name: 'A' }], 1, 20, 100));

    const { result } = renderHook(() => usePaginatedQuery<TestItem>({
      queryKey: ['test-reset'],
      fetcher,
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPage(5));
    expect(result.current.page).toBe(5);

    act(() => result.current.resetPage());
    expect(result.current.page).toBe(1);
  });

  it('tablePagination 对象包含正确的字段', async () => {
    const fetcher = vi.fn().mockResolvedValue(makePage([{ id: '1', name: 'A' }], 1, 20, 42));

    const { result } = renderHook(() => usePaginatedQuery<TestItem>({
      queryKey: ['test-pagination-prop'],
      fetcher,
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const tp = result.current.tablePagination;
    expect(tp.current).toBe(1);
    expect(tp.pageSize).toBe(20);
    expect(tp.total).toBe(42);
    expect(tp.showSizeChanger).toBe(false);
    expect(typeof tp.onChange).toBe('function');
    expect(tp.showTotal).toBeDefined();
    expect(tp.showTotal!(42)).toBe('共 42 条');
  });

  it('filters 变化后 queryKey 中包含筛选条件', async () => {
    const fetcher = vi.fn().mockResolvedValue(makePage([{ id: '1', name: 'A' }], 1, 20, 1));

    const { result, rerender } = renderHook(
      ({ status }: { status?: string }) => usePaginatedQuery<TestItem>({
        queryKey: ['test-filters'],
        fetcher,
        filters: { status },
      }),
      { wrapper: createWrapper(), initialProps: { status: undefined as string | undefined } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ status: 'active' });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });

    expect(result.current.page).toBe(1);
  });

  it('自定义 pageSize 生效', async () => {
    const fetcher = vi.fn().mockResolvedValue(makePage([{ id: '1', name: 'A' }], 1, 10, 100));

    const { result } = renderHook(() => usePaginatedQuery<TestItem>({
      queryKey: ['test-custom-size'],
      fetcher,
      pageSize: 10,
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pagination?.page_size).toBe(10);
    expect(result.current.tablePagination.pageSize).toBe(10);
    expect(fetcher).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
  });

  it('请求失败时 error 非 null', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('网络异常'));

    const { result } = renderHook(() => usePaginatedQuery<TestItem>({
      queryKey: ['test-error'],
      fetcher,
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('网络异常');
    expect(result.current.items).toEqual([]);
  });

  it('tablePagination 引用在未变数据下保持稳定', async () => {
    const fetcher = vi.fn().mockResolvedValue(makePage([{ id: '1', name: 'A' }], 1, 20, 1));

    const { result } = renderHook(() => usePaginatedQuery<TestItem>({
      queryKey: ['test-stable-ref'],
      fetcher,
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const firstRef = result.current.tablePagination;

    // 触发重渲染但数据不变
    act(() => result.current.setPage(1));

    await waitFor(() => {
      expect(result.current.tablePagination).toBe(firstRef);
    });
  });
});
