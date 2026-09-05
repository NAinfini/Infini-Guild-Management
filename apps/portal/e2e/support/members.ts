import { usersListResponseSchema, type AdminRole, type User, type UsersListResponse } from "@guild/shared";
import type { APIRequestContext, Page, Request } from "@playwright/test";
import { isRoleAssignableToUser } from "../../utils/permissions";
import { expect, readJson } from "./test";

/*
 * 一次性成员：成员管理相关用例的统一靶子。
 *
 * 为什么不拿种子成员开刀：改角色、停用、批量删除都不会被运行收尾还原，
 * 而收尾的指纹只数每张表的行数——「行数没变、内容变了」这类污染它一条都查不出来，
 * 后面的用例会在一份被悄悄改过的种子数据上跑。
 *
 * 走 POST /api/admin/users 建出来的账号会被登记进本次运行的清理注册表，
 * 收尾时按 id 硬删，连带 member_profiles、user_credentials、会话、
 * 审计行会一起清掉，所以怎么折腾都不留痕。
 */

export type ThrowawayMember = {
  id: string;
  login_name: string;
  display_name: string;
  password: string;
  role: AdminRole;
};

let counter = 0;
const authorityByApi = new WeakMap<APIRequestContext, Promise<{ user: User; roles: AdminRole[] }>>();

async function readAuthority(api: APIRequestContext): Promise<{ user: User; roles: AdminRole[] }> {
  const cached = authorityByApi.get(api);
  if (cached) return await cached;

  const pending = Promise.all([
    readJson(await api.get("/api/auth/me"), "读取当前管理员权限") as Promise<{ user: User }>,
    readJson(await api.get("/api/admin/roles"), "读取 D1 角色列表") as Promise<AdminRole[]>,
  ]).then(([me, roles]) => ({ user: me.user, roles }));
  authorityByApi.set(api, pending);
  return await pending;
}

/** 当前管理员可以唯一、完整授予的 D1 角色，按级别从低到高排列。 */
export async function readAssignableRoles(api: APIRequestContext): Promise<AdminRole[]> {
  const { user, roles } = await readAuthority(api);
  return roles
    .filter((role) => isRoleAssignableToUser(role, user))
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
}

/** 取一个真实可授予角色；没有合法角色时明确失败，不能退回静态角色 id。 */
export async function readAssignableRole(api: APIRequestContext): Promise<AdminRole> {
  const role = (await readAssignableRoles(api))[0];
  if (!role) throw new Error("当前管理员没有可授予的 D1 角色");
  return role;
}

/**
 * 一条用例专属的标签，同时充当搜索词。
 * 一次性账号在整轮运行结束前都不会被删，所以按「e2e_」这种大前缀搜会连上
 * 别的用例留下的账号；每条用例自己一个标签，搜出来的行数才是可预期的。
 */
export function uniqueTag(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

/** 建一个挂在本次运行名下的一次性成员。登录名和显示名不能以 systemtest 开头（保留前缀）。 */
export async function createThrowawayMember(
  api: APIRequestContext,
  tag: string,
  role?: AdminRole,
): Promise<ThrowawayMember> {
  counter += 1;
  const display_name = `e2e_${tag}_${counter}`;
  const login_name = `e2e_login_${Date.now().toString(36)}_${counter}`;
  const assignedRole = role ?? await readAssignableRole(api);
  const created = await readJson(
    await api.post("/api/admin/users", { data: { login_name, display_name, role_id: assignedRole.id } }),
    `创建一次性成员 ${display_name}`,
  ) as {
    user_id: string;
    display_name: string;
    temporary_login_name: string;
    temporary_password: string;
  };
  return {
    id: created.user_id,
    login_name: created.temporary_login_name,
    display_name: created.display_name,
    password: created.temporary_password,
    role: assignedRole,
  };
}

/** 新查询只读当前页；响应完成后继续观察，防止又串行拉取后续整页。 */
export async function expectMemberListPage(
  page: Page,
  query: Record<string, string | null>,
  action: () => Promise<unknown>,
): Promise<UsersListResponse> {
  const expected = { include_total: "true", ...query };
  const calls: Request[] = [];
  const writes: string[] = [];
  const record = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/users") calls.push(request);
    if (path.startsWith("/api/") && request.method() !== "GET") writes.push(`${request.method()} ${path}`);
  };
  page.on("request", record);
  try {
    const pending = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname === "/api/users"
        && Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === value);
    });
    await action();
    const response = await pending;
    expect(response.status(), `成员分页请求失败：${await response.text()}`).toBe(200);
    const result = usersListResponseSchema.parse(await response.json());
    expect(result.page).toBe(Number(query.page));
    expect(result.limit).toBe(Number(query.limit));
    expect(result.data.length, "每次响应不得超过请求页大小").toBeLessThanOrEqual(result.limit);
    expect(new Set(result.data.map((row) => row.user.id)).size, "同一页不应出现重复成员").toBe(result.data.length);
    await page.waitForTimeout(350);
    expect(calls, "一个新查询只应请求当前页，不能顺带遍历整个成员目录").toHaveLength(1);
    expect(Object.fromEntries(new URL(calls[0]!.url()).searchParams)).toEqual(
      Object.fromEntries(Object.entries(expected).filter(([, value]) => value !== null)),
    );
    expect(writes, "浏览成员列表不得写库").toEqual([]);
    return result;
  } finally {
    page.off("request", record);
  }
}

/** 等防抖查询及其结果落地后，后续纯交互才能单独计算网络请求。 */
export async function searchAdminMembers(page: Page, search: string): Promise<UsersListResponse> {
  const result = await expectMemberListPage(page, {
    page: "1", limit: "20", search_scope: "management", sort: "created_at", direction: "asc",
    search: search.trim() || null,
  }, () => page.getByRole("textbox", { name: "Search members", exact: true }).fill(search));
  await expect(page.locator(".admin-stat__value").first()).toHaveText(String(result.stats!.total));
  if (result.data.length > 0) {
    await expect(page.getByRole("row", {
      name: `${result.data[0]!.user.display_name} member row`, exact: true,
    })).toBeVisible();
  } else {
    await expect(page.getByRole("row", { name: /member row$/ })).toHaveCount(0);
  }
  return result;
}
