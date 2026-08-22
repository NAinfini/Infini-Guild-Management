import type { ClassCatalogItem, ClassTag } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { useState, type ReactElement, type ReactNode } from "react";
import { queryKeys } from "../api/query-keys";

/*
 * 职业目录/标签走 TanStack Query 缓存，渲染任何读目录的组件都必须挂
 * QueryClientProvider。这里是测试侧唯一的装配点：种子直接写进缓存，
 * staleTime: Infinity 挡住后台重拉（不会发真实请求），行为等价于旧
 * Zustand store 的一次性灌入；不传种子就是空目录，degraded 渲染兜底。
 */
export function createSeededQueryClient(seed?: {
  classes?: ClassCatalogItem[];
  classTags?: ClassTag[];
}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.classes.list(), seed?.classes ?? []);
  queryClient.setQueryData(queryKeys.classTags.list(), seed?.classTags ?? []);
  return queryClient;
}

export function QueryHarness({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createSeededQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function renderWithQueryClient(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  return render(ui, { wrapper: QueryHarness, ...options });
}
