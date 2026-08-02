import type { APIRequestContext } from "@playwright/test";
import { readJson } from "./test";

/*
 * 一次性成员：成员管理相关用例的统一靶子。
 *
 * 为什么不拿种子成员开刀：改角色、停用、批量删除都不会被运行收尾还原，
 * 而收尾的指纹只数每张表的行数——「行数没变、内容变了」这类污染它一条都查不出来，
 * 后面的用例会在一份被悄悄改过的种子数据上跑。
 *
 * 走 POST /api/admin/users 建出来的账号会被登记进本次运行的清理注册表，
 * 收尾时按 id 硬删，连带 member_profiles、user_auth_password、会话、
 * 审计行和 login_failures 一起清掉，所以怎么折腾都不留痕。
 */

export type ThrowawayMember = { id: string; username: string; password: string };

let counter = 0;

/**
 * 一条用例专属的标签，同时充当搜索词。
 * 一次性账号在整轮运行结束前都不会被删，所以按「e2e_」这种大前缀搜会连上
 * 别的用例留下的账号；每条用例自己一个标签，搜出来的行数才是可预期的。
 */
export function uniqueTag(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

/** 建一个挂在本次运行名下的一次性成员。用户名不能以 systemtest 开头（保留前缀）。 */
export async function createThrowawayMember(
  api: APIRequestContext,
  tag: string,
): Promise<ThrowawayMember> {
  counter += 1;
  const username = `e2e_${tag}_${counter}`;
  const created = await readJson(
    await api.post("/api/admin/users", { data: { username } }),
    `创建一次性成员 ${username}`,
  ) as { user_id: string; username: string; temporary_password: string };
  return { id: created.user_id, username: created.username, password: created.temporary_password };
}
