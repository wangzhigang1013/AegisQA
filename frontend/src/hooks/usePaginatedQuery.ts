import { useCallback, useMemo, useState } from 'react';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

export interface PaginationInfo {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationInfo;
}

export interface UsePaginatedQueryOptions<T> {
  /** React Query key prefix, e.g. ['tasks', 'list'] */
  queryKey: unknown[];
  /** Fetcher that accepts page/pageSize and returns paginated response */
  fetcher: (params: { page: number; pageSize: number }) => Promise<PaginatedResponse<T>>;
  /** Page size, default 20 */
  pageSize?: number;
  /** Additional filters to include in queryKey for cache invalidation */
  filters?: Record<string, string | number | boolean | undefined>;
  /** React Query options (enabled, staleTime, etc.) */
  queryOptions?: Omit<UseQueryOptions<PaginatedResponse<T>>, 'queryKey' | 'queryFn'>;
}

export interface UsePaginatedQueryResult<T> {
  /** Current page items */
  items: T[];
  /** Raw pagination metadata from server */
  pagination: PaginationInfo | undefined;
  /** Current page number (1-based) */
  page: number;
  /** Set page number */
  setPage: (page: number) => void;
  /** Reset to page 1 */
  resetPage: () => void;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Ant Design Table pagination prop (ready to spread) */
  tablePagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
    showSizeChanger?: boolean;
    showTotal?: (total: number) => string;
  };
}

const DEFAULT_PAGE_SIZE = 20;

export function usePaginatedQuery<T>(options: UsePaginatedQueryOptions<T>): UsePaginatedQueryResult<T> {
  const { queryKey, fetcher, pageSize = DEFAULT_PAGE_SIZE, filters, queryOptions } = options;
  const [page, setPage] = useState(1);

  const filterKey = useMemo(() => {
    if (!filters) return '';
    const sorted = Object.entries(filters)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${String(value)}`)
      .join('|');
    return sorted;
  }, [filters]);

  const fullQueryKey = useMemo(
    () => [...queryKey, page, pageSize, filterKey],
    [queryKey, page, pageSize, filterKey],
  );

  const query = useQuery<PaginatedResponse<T>>({
    ...queryOptions,
    queryKey: fullQueryKey,
    queryFn: () => fetcher({ page, pageSize }),
  });

  const resetPage = useCallback(() => setPage(1), []);

  const handleChange = useCallback((newPage: number) => setPage(newPage), []);

  const tablePagination = useMemo(
    () => ({
      current: query.data?.pagination?.page ?? page,
      pageSize: query.data?.pagination?.page_size ?? pageSize,
      total: query.data?.pagination?.total_items ?? 0,
      onChange: handleChange,
      showSizeChanger: false as const,
      showTotal: (total: number) => `共 ${total} 条`,
    }),
    [query.data?.pagination?.page, query.data?.pagination?.page_size, query.data?.pagination?.total_items, page, pageSize, handleChange],
  );

  return {
    items: query.data?.items ?? [],
    pagination: query.data?.pagination,
    page,
    setPage,
    resetPage,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    tablePagination,
  };
}
