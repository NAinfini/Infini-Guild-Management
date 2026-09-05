import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { SYSTEM_TEST_CONTENT_MARKER } from "@guild/shared/config/system-test";
import { expect, readJson, test } from "../../support/test";
import { MEMBER_DISPLAY_NAME } from "../../support/config";
import { confirmDialog } from "../../support/ui";

/*
 * 活动详情页里的四组控件：加人、移人、投票、抽奖。
 *
 * 这四个都是写操作，所以每条用例都要求请求真的发出去、服务端那一行真的变了、
 * 页面上的呈现跟着变。只看 toast 验不出问题——成功提示挂在 onSuccess 上，
 * 服务端写没写进去它并不知道；抽奖更是随机的，不回读就只能确认「点过了」。
 *
 * 详情页直接走 /events/:id，刷新页面后仍由真实详情查询承载。移除成员和抽奖
 * 都会在页面之上再叠一层全局确认框。
 */

const ADD_PARTICIPANTS = { method: "POST", path: /^\/api\/events\/[^/]+\/participants$/ } as const;
const REMOVE_PARTICIPANTS = { method: "DELETE", path: /^\/api\/events\/[^/]+\/participants$/ } as const;
const VOTE_POLL = { method: "POST", path: /^\/api\/events\/[^/]+\/poll\/vote$/ } as const;
const DRAW_RAFFLE = { method: "POST", path: /^\/api\/events\/[^/]+\/raffle\/draw$/ } as const;

/* 开始时间推到一年以后：报名时间冲突确认框（useEventsParticipantMutations.handleJoin）
   只在时间重叠时才弹，推远就不会被既有报名情况带偏；投票也要求投票期未结束。 */
const START_OFFSET_MS = 400 * 24 * 60 * 60_000;
const END_OFFSET_MS = START_OFFSET_MS + 2 * 60 * 60_000;

type ServerEvent = {
  id: string;
  title: string;
  signup_locked: boolean;
  participants: { user_id: string }[];
  poll?: {
    options: { id: string; label: string; vote_count: number; voter_ids: string[] }[];
  } | null;
  winner_count?: number | null;
  raffle_winners?: { user_id: string }[];
};

type Person = { id: string; display_name: string };

let stamp: number;
let title: string;
let viewer: Person;
let member: Person;

test.beforeEach(async ({ api }) => {
  stamp = Date.now();
  title = `${SYSTEM_TEST_CONTENT_MARKER} Detail ${stamp}`;

  const session = await readJson(await api.get("/api/auth/me"), "回读当前会话") as { user: Person };
  viewer = session.user;

  /*
   * 「把别人加进活动」必须真的加别人。用当前管理员自己顶替，等于把这条路径
   * 退化成报名，加人和报名走的却是两个不同的接口和权限判定。
   * member_01 是 e2e 的种子账号（support/config.ts），没有它整套 e2e 本来就跑不起来。
   */
  const users = await readJson(
    await api.get("/api/users?page=1&limit=500&include_total=false"),
    "回读成员名录",
  ) as { data: { user: Person & { is_active: boolean; deleted_at: string | null } }[] };
  const found = users.data.find((entry) => entry.user.display_name === MEMBER_DISPLAY_NAME);
  expect(found, `名录里必须有种子成员 ${MEMBER_DISPLAY_NAME}，否则这条用例验的不是加别人`).toBeTruthy();
  member = { id: found!.user.id, display_name: found!.user.display_name };
});

test.afterEach(async ({ api }) => {
  const list = await readJson(
    await api.get(`/api/events?search=${stamp}&limit=50`),
    "回读待清理的活动",
  ) as { data: { id: string }[] };
  for (const entry of list.data) {
    const response = await api.delete(`/api/events/${entry.id}/destroy`);
    expect([200, 204, 404], `清理活动返回 ${response.status()}`).toContain(response.status());
  }
});

async function createEvent(api: APIRequestContext, extra: Record<string, unknown>): Promise<string> {
  const created = await readJson(
    await api.post("/api/events", {
      data: {
        title,
        start_at: new Date(Date.now() + START_OFFSET_MS).toISOString(),
        end_at: new Date(Date.now() + END_OFFSET_MS).toISOString(),
        ...extra,
      },
    }),
    "创建活动",
  ) as { id: string };
  return created.id;
}

async function readEvent(api: APIRequestContext, id: string): Promise<ServerEvent> {
  return await readJson(await api.get(`/api/events/${id}`), `回读活动 ${id}`) as ServerEvent;
}

/** 打开真实详情页。 */
async function openDetail(page: Page, eventId: string): Promise<Locator> {
  await page.goto(`/events/${eventId}`);
  const detail = page.locator(".event-detail-content__layout");
  await expect(detail, "/events/:id 必须直接打开真实详情页").toBeVisible();
  return detail;
}

function membersSection(detail: Locator): Locator {
  return detail.locator(".event-detail-content__section--members");
}

function memberRow(detail: Locator, display_name: string): Locator {
  return membersSection(detail).locator(".event-detail-content__member-row").filter({ hasText: display_name });
}

function pollRow(detail: Locator, label: string): Locator {
  return detail.locator(".event-detail-content__poll-result-row").filter({ hasText: label });
}

test("加人：下拉选中一个成员就落库，人数标题和名单一起变", async ({ page, flow, api }) => {
  const eventId = await createEvent(api, { type: "social", capacity: 5 });
  const detail = await openDetail(page, eventId);

  await expect(detail.getByText("Members (0 / 5)", { exact: true })).toBeVisible();
  await expect(detail.getByText("No members have joined yet.", { exact: true })).toBeVisible();

  const picker = detail.getByPlaceholder("Select member to add");
  const search = member.display_name.slice(0, -1);
  await flow.act(() => picker.fill(search), {
    method: "GET",
    path: /^\/api\/users\/directory$/,
    query: { search },
  });
  await expect(detail.locator(`datalist option[value="${member.display_name}"]`)).toHaveCount(1);

  // 原生 datalist 的选项位于浏览器界面；候选加载后填入完整值才等同于选中。
  await flow.act(
    () => picker.fill(member.display_name),
    ADD_PARTICIPANTS,
  );

  expect(
    (await readEvent(api, eventId)).participants.map((entry) => entry.user_id),
    "服务端参与者名单里必须出现被选中的成员",
  ).toEqual([member.id]);

  await expect(detail.getByText("Members (1 / 5)", { exact: true }), "人数标题要跟着加一").toBeVisible();
  await expect(memberRow(detail, member.display_name), "名单里必须出现这个人").toHaveCount(1);
  await expect(
    picker,
    "选完要清空，否则连着加第二个人时下拉里还挂着上一个",
  ).toHaveValue("");
});

test("移人：取消确认什么都不做，确认后名单和服务端一起清空", async ({ page, flow, api }) => {
  const eventId = await createEvent(api, { type: "social" });
  await readJson(
    await api.post(`/api/events/${eventId}/participants`, { data: { user_ids: [member.id] } }),
    "预置一名参与者",
  );

  const detail = await openDetail(page, eventId);
  await expect(detail.getByText("Members (1)", { exact: true })).toBeVisible();

  const removeButton = memberRow(detail, member.display_name).getByRole("button", { name: "Remove", exact: true });

  await removeButton.click();
  await (await confirmDialog(page, "Remove member?"))
    .getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await readEvent(api, eventId)).participants,
    "取消确认后不该动名单",
  ).toHaveLength(1);

  await removeButton.click();
  const dialog = await confirmDialog(page, "Remove member?");
  await expect(
    dialog,
    "确认框要写清楚移的是谁，否则一排 Remove 按钮点错了也看不出来",
  ).toContainText(`Remove ${member.display_name} from this event?`);
  await flow.act(
    async () => {
      await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    },
    REMOVE_PARTICIPANTS,
  );

  expect((await readEvent(api, eventId)).participants, "确认后服务端名单必须清空").toEqual([]);
  await expect(detail.getByText("Members (0)", { exact: true })).toBeVisible();
  await expect(detail.getByText("No members have joined yet.", { exact: true })).toBeVisible();
});

test("投票：先选后投才可提交，改投会把票挪到另一个选项上", async ({ page, flow, api }) => {
  const optionA = `A-${stamp}`;
  const optionB = `B-${stamp}`;
  const eventId = await createEvent(api, {
    type: "poll",
    poll: { options: [optionA, optionB], results_visibility: "always", show_voter_names: true },
  });
  const detail = await openDetail(page, eventId);

  const voteButton = detail.getByRole("button", { name: "Vote", exact: true });
  await expect(voteButton, "一个选项都没选时投票没有意义，必须禁用").toBeDisabled();
  await expect(detail.locator(".event-detail-content__poll-total")).toHaveText("0 votes");

  await pollRow(detail, optionA).click();
  await expect(pollRow(detail, optionA)).toHaveAttribute("aria-checked", "true");
  await expect(voteButton).toBeEnabled();

  await flow.click(voteButton, VOTE_POLL);

  const afterFirst = await readEvent(api, eventId);
  const firstA = afterFirst.poll?.options.find((option) => option.label === optionA);
  expect(firstA?.vote_count, "服务端必须真的记下这一票").toBe(1);
  expect(firstA?.voter_ids, "投票人也要落库，否则「谁投的」是编出来的").toEqual([viewer.id]);
  expect(afterFirst.poll?.options.find((option) => option.label === optionB)?.vote_count).toBe(0);

  await expect(pollRow(detail, optionA).locator(".event-detail-content__poll-percent")).toHaveText("100%");
  await expect(
    pollRow(detail, optionA).getByRole("button", { name: viewer.display_name, exact: true }),
    "投票人改为头像呈现后，身份仍必须通过头像按钮的无障碍名称可识别",
  ).toBeVisible();
  await expect(detail.locator(".event-detail-content__poll-total")).toHaveText("1 vote");

  const updateButton = detail.getByRole("button", { name: "Update vote", exact: true });
  await expect(updateButton, "投过之后按钮要变成改投，否则用户以为再点一次是投第二票").toBeVisible();

  /*
   * 改投走的是同一个接口，服务端先删后插（EventPollRaffleService.votePoll）。
   * 只断言 B 变成 1 是不够的：A 没被删掉的话总票数会翻倍，而百分比照样显示 50/50。
   */
  await pollRow(detail, optionA).click();
  await pollRow(detail, optionB).click();
  await flow.click(updateButton, VOTE_POLL);

  const afterSecond = await readEvent(api, eventId);
  expect(afterSecond.poll?.options.find((option) => option.label === optionA)?.vote_count, "旧票必须被撤掉").toBe(0);
  expect(afterSecond.poll?.options.find((option) => option.label === optionB)?.vote_count).toBe(1);
  await expect(detail.locator(".event-detail-content__poll-total")).toHaveText("1 vote");
  await expect(pollRow(detail, optionB).locator(".event-detail-content__poll-percent")).toHaveText("100%");
});

test("抽奖：取消不开奖，确认后按设定的人数抽出中奖者并锁上报名", async ({ page, flow, api }) => {
  const eventId = await createEvent(api, { type: "raffle", winner_count: 2 });
  await readJson(
    await api.post(`/api/events/${eventId}/participants`, { data: { user_ids: [viewer.id, member.id] } }),
    "预置抽奖池",
  );

  const detail = await openDetail(page, eventId);
  await expect(detail.getByText("2 in pool", { exact: true })).toBeVisible();
  await expect(detail.getByText("2 winners to be drawn", { exact: true })).toBeVisible();

  const drawButton = detail.getByRole("button", { name: "Draw Winners Now", exact: true });

  await drawButton.click();
  const cancelDialog = await confirmDialog(page, "Draw Winners");
  await expect(
    cancelDialog,
    "确认框要把人数和奖池说清楚——开奖不可撤销，说错了就没有第二次机会",
  ).toContainText("This will randomly select 2 winners from 2 participants.");
  await cancelDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await readEvent(api, eventId)).raffle_winners, "取消后不该开奖").toEqual([]);

  await drawButton.click();
  await flow.act(
    async () => {
      await (await confirmDialog(page, "Draw Winners"))
        .getByRole("button", { name: "Draw Winners Now", exact: true }).click();
    },
    DRAW_RAFFLE,
  );

  const drawn = await readEvent(api, eventId);
  expect(drawn.raffle_winners?.length, "中奖人数必须等于设定的 winner_count").toBe(2);
  expect(
    drawn.raffle_winners?.map((winner) => winner.user_id).sort(),
    "中奖者只能来自奖池",
  ).toEqual([viewer.id, member.id].sort());
  expect(drawn.signup_locked, "开奖会顺手锁上报名（EventPollRaffleService.drawRaffleWinners）").toBe(true);

  await expect(detail.getByText("Drawn", { exact: true })).toBeVisible();
  await expect(drawButton, "开过奖就不该还能再开一次").toHaveCount(0);
  await expect(detail.getByText("Winners", { exact: true })).toBeVisible();
  for (const person of [viewer, member]) {
    await expect(
      detail.locator(".event-detail-content__section--raffle").getByText(person.display_name, { exact: true }),
      `中奖名单里必须列出 ${person.display_name}`,
    ).toBeVisible();
  }
  await expect(
    membersSection(detail).getByRole("button", { name: "Cancel signup", exact: true }),
    "报名被锁上之后就不能再进出了",
  ).toBeDisabled();
});
