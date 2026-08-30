import { QueryClient } from "@tanstack/react-query";
import { isApiRequestError } from "./client";

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 1
    && (!isApiRequestError(error) || error.status === 0 || error.status >= 500);
}

/*
 * 全应用唯一的 QueryClient。单独成模块是因为它有两个使用方：bootstrap 在
 * 挂载前用 fetchQuery 预热职业目录/标签缓存（失败即中止启动），router 把同
 * 一个实例交给 QueryClientProvider——两边必须是同一份缓存。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
    },
  },
});
