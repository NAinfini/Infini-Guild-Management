import type { Response } from "@playwright/test";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** 一次控件操作应该在网络上留下的痕迹。 */
export type ApiExpectation = {
  method: HttpMethod;
  /** 匹配 pathname（不含查询串），用正则是因为大部分路径里带 id。 */
  path: RegExp;
  /** 搜索、筛选等操作必须区分同一路径上的后台刷新。 */
  query?: Record<string, string>;
  /** 默认要求 2xx；只有在专门验证失败分支时才显式写非 2xx。 */
  status?: number;
};

export function matchesApiResponse(
  response: Pick<Response, "url" | "request">,
  expected: ApiExpectation,
): boolean {
  const url = new URL(response.url());
  return response.request().method() === expected.method
    && expected.path.test(url.pathname)
    && Object.entries(expected.query ?? {}).every(([key, value]) => url.searchParams.get(key) === value);
}
