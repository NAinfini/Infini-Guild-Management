import { z } from "zod";
import { LIMITS } from "../config/limits";
import { EVENT_TYPES } from "../constants/event-types";
import { RECURRENCE_FREQUENCIES, POLL_RESULTS_VISIBILITIES } from "../constants/events";
import { classTagLabelSchema, classTagMembersSchema } from "./class-tag";

const L = LIMITS.content;

const recurrenceRuleSchema = z.object({
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().positive(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  endAfter: z.number().int().positive().optional(),
  endDate: z.string().datetime().optional(),
});
const eventAttachmentsSchema = z.array(z.string().min(1)).max(L.eventAttachments.max);
const pollResultsVisibilitySchema = z.enum(POLL_RESULTS_VISIBILITIES);
const eventTypeIdSchema = z.enum(EVENT_TYPES);

/*
 * 每一格配额指向一个职业标签，说的是「这一格要 N 个人，标签里的职业都算数」。只要
 * 一个职业的旧写法就是一个只装了它自己的标签。
 *
 * 配额只是可视化信号，服务端不会拿它拦报名——报名的硬上限只有 capacity 一个。
 * required 不设与 capacity 的联动校验：配额是 capacity 的子集，两者独立，管理员完全
 * 可以先配好职业需求再决定放多少人。
 */
export const eventClassQuotaSchema = z.object({
  tag_id: z.string().min(1),
  /*
   * 标签的名字和成员随活动一起返回，卡片画筹码不用再单独请求一次标签表。
   * label 允许为空是给悬空配额留的口子：标签被删干净了、配额行却还在，这时把它照原样
   * 露出来（展示层显示成未知标签），而不是 JOIN 一滤了事——那是 bug，得看得见。
   */
  label: z.string().nullable(),
  class_ids: z.array(z.string().min(1)),
  required: z.number().int().positive(),
  /*
   * 这一格用的是活动自己的一次性组，还是目录里的公用标签。
   * 编辑器靠它决定回传哪一种写法：一次性组每次保存都是重建，把它的 tag_id 当公用标签
   * 回传会指向一个下一秒就被删掉的行，所以服务端干脆不认这种 id（见
   * findUnknownTagIds），这一位就是让客户端不至于撞上那道墙。
   */
  one_time: z.boolean(),
});
const eventClassQuotasSchema = z.array(eventClassQuotaSchema).max(L.eventClassQuotas.max);

/*
 * 写入时一格有两种写法：
 *   { tag_id } —— 指着职业目录里的公用标签，名字和成员归标签自己管。
 *   { tag }    —— 就地造一个一次性组，只服务这一个活动／模板，不进目录、不占用名字。
 * 一次性组没有值得保留的身份：每次保存都整组重建（跟配额行本身一样是整组替换），所以
 * 它没有 id 这一说，客户端也不必替它记住什么。
 */
export const eventClassQuotaInputSchema = z.union([
  z.object({
    tag_id: z.string().min(1),
    required: z.number().int().positive(),
  }).strict(),
  z.object({
    tag: z.object({ label: classTagLabelSchema, class_ids: classTagMembersSchema }).strict(),
    required: z.number().int().positive(),
  }).strict(),
]);
const eventClassQuotaInputsSchema = z.array(eventClassQuotaInputSchema).max(L.eventClassQuotas.max);

/** superRefine 拿到的是解析后的联合，两个分支只有一个字段在，所以两个都是可选的。 */
type ClassQuotaInputLike = { tag_id?: string; required: number };

const eventPollOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  vote_count: z.number().int().nonnegative(),
  voter_ids: z.array(z.string()),
  voted_by_me: z.boolean(),
});

export const eventPollSchema = z.object({
  results_visibility: pollResultsVisibilitySchema,
  show_voter_names: z.boolean(),
  has_voted: z.boolean(),
  can_vote: z.boolean(),
  options: z.array(eventPollOptionSchema),
});

const pollSettingsSchema = z.object({
  options: z.array(z.string().trim().min(1)).min(2).max(10),
  results_visibility: pollResultsVisibilitySchema.default("after_vote"),
  show_voter_names: z.boolean().default(false),
});

export const pollVoteSchema = z.object({
  option_ids: z.array(z.string().min(1)).min(1).max(10),
});

export const eventRaffleWinnerSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  user_id: z.string(),
  drawn_at: z.string(),
});

export const eventSchema = z.object({
  id: z.string(),
  type: eventTypeIdSchema,
  title: z.string(),
  description: z.string().nullable(),
  start_at: z.string(),
  end_at: z.string().nullable(),
  capacity: z.number().int().nullable(),
  pinned: z.boolean(),
  signup_locked: z.boolean(),
  auto_archive: z.boolean(),
  auto_archived: z.boolean(),
  visible_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_by: z.string(),
  updated_by: z.string().nullable(),
  attachments: eventAttachmentsSchema.default([]),
  class_quotas: eventClassQuotasSchema.default([]),
  series_id: z.string().nullable(),
  instance_date: z.string().nullable(),
  poll: eventPollSchema.nullable().optional(),
  winner_count: z.number().int().nullable().optional(),
  raffle_winners: z.array(eventRaffleWinnerSchema).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const eventMutationSchema = z.object({
  type: eventTypeIdSchema,
  title: z.string().min(L.eventTitle.min).max(L.eventTitle.max),
  description: z.string().max(L.eventDescription.max).optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime().optional(),
  capacity: z.number().int().positive().optional(),
  attachments: eventAttachmentsSchema.optional(),
  class_quotas: eventClassQuotaInputsSchema.optional(),
  auto_archive: z.boolean().optional(),
  poll: pollSettingsSchema.optional(),
  winner_count: z.number().int().positive().optional(),
});

/*
 * 配额自己的规则，活动和周期模板共用一份：模板生成出来的活动会原样继承配额，
 * 两边校验若不一致，模板就能种下一批活动侧拒收的数据。
 * 投票的「参与者」是投票人，抽奖的是抽签池，两者都不是一支队伍——职业配额在这两种
 * 类型下没有含义，宁可报错也不要静默丢弃。
 */
function refineClassQuotas(
  value: { type?: string; class_quotas?: ClassQuotaInputLike[] },
  ctx: z.RefinementCtx,
): void {
  if (!value.class_quotas || value.class_quotas.length === 0) {
    return;
  }
  if (value.type === "poll" || value.type === "raffle") {
    ctx.addIssue({ code: "custom", path: ["class_quotas"], message: `${value.type} events do not use class quotas` });
  }
  /* 同一个标签占两格没有意义，两格加起来就是一格。重叠的**不同**标签是允许的。
     一次性组不参与这条：它们每个都是新造的，天生不会重复，两个同名的一次性组是
     管理员的自由（名字冲突的唯一索引只管目录标签）。 */
  const seen = new Set<string>();
  value.class_quotas.forEach((quota, index) => {
    if (quota.tag_id === undefined) return;
    if (seen.has(quota.tag_id)) {
      ctx.addIssue({ code: "custom", path: ["class_quotas", index, "tag_id"], message: "Duplicate class quota" });
    }
    seen.add(quota.tag_id);
  });
}

function refineEventRules(
  value: {
    type?: string;
    start_at?: string;
    end_at?: string;
    poll?: unknown;
    capacity?: unknown;
    winner_count?: unknown;
    class_quotas?: ClassQuotaInputLike[];
  },
  ctx: z.RefinementCtx,
  isUpdate: boolean,
): void {
  refineClassQuotas(value, ctx);
  if (value.start_at && value.end_at && value.end_at <= value.start_at) {
    ctx.addIssue({ code: "custom", path: ["end_at"], message: "end_at must be after start_at" });
  }
  if (value.type === "poll") {
    if (isUpdate ? value.end_at === undefined : !value.end_at) {
      ctx.addIssue({ code: "custom", path: ["end_at"], message: "Poll events require end_at" });
    }
    if (!value.poll) {
      ctx.addIssue({ code: "custom", path: ["poll"], message: "Poll events require poll settings" });
    }
    if (value.capacity !== undefined) {
      ctx.addIssue({ code: "custom", path: ["capacity"], message: "Poll events do not use capacity" });
    }
  } else if (isUpdate ? (value.type !== undefined && value.poll !== undefined) : value.poll !== undefined) {
    ctx.addIssue({ code: "custom", path: ["poll"], message: "Only poll events can include poll settings" });
  }
  if (value.type === "raffle") {
    if (isUpdate ? value.end_at === undefined : !value.end_at) {
      ctx.addIssue({ code: "custom", path: ["end_at"], message: "Raffle events require end_at" });
    }
    if (!isUpdate && !value.winner_count) {
      ctx.addIssue({ code: "custom", path: ["winner_count"], message: "Raffle events require winner_count" });
    }
  } else if (isUpdate ? (value.type !== undefined && value.winner_count !== undefined) : value.winner_count !== undefined) {
    ctx.addIssue({ code: "custom", path: ["winner_count"], message: "Only raffle events can include winner_count" });
  }
}

export const createEventSchema = eventMutationSchema.superRefine((v, ctx) => refineEventRules(v, ctx, false));

export const updateEventSchema = eventMutationSchema.partial().extend({
  pinned: z.boolean().optional(),
  signup_locked: z.boolean().optional(),
  archived_at: z.string().datetime().nullable().optional(),
}).superRefine((v, ctx) => refineEventRules(v, ctx, true));

export const eventParticipantSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  user_id: z.string(),
  joined_at: z.string(),
});

export const eventParticipantsBatchSchema = z.object({
  user_ids: z.array(z.string().min(1)).min(1).max(L.eventParticipantsBatch.max),
});

// ── Recurring Templates ──

export const recurringTemplateSchema = z.object({
  id: z.string(),
  type: eventTypeIdSchema,
  title: z.string(),
  description: z.string().nullable(),
  start_time: z.string(),
  duration_minutes: z.number().int().nullable(),
  capacity: z.number().int().nullable(),
  recurrence_rule: recurrenceRuleSchema,
  visibility_offset_minutes: z.number().int(),
  auto_archive: z.boolean(),
  attachments: eventAttachmentsSchema.default([]),
  class_quotas: eventClassQuotasSchema.default([]),
  paused: z.boolean(),
  created_by: z.string(),
  last_generated_date: z.string().nullable(),
  generation_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

const templateMutationSchema = z.object({
  type: eventTypeIdSchema,
  title: z.string().min(L.eventTitle.min).max(L.eventTitle.max),
  description: z.string().max(L.eventDescription.max).optional(),
  // UTC wall-clock time "HH:mm" — the portal converts local input to UTC
  // before submitting (see shared/utils/recurrence.ts contract).
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  duration_minutes: z.number().int().min(0).optional(),
  capacity: z.number().int().positive().optional(),
  recurrence_rule: recurrenceRuleSchema,
  visibility_offset_minutes: z.number().int().min(0).optional(),
  auto_archive: z.boolean().optional(),
  class_quotas: eventClassQuotaInputsSchema.optional(),
});

export const createTemplateSchema = templateMutationSchema.superRefine(refineClassQuotas);

export const updateTemplateSchema = templateMutationSchema.partial().superRefine(refineClassQuotas);
