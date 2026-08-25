import { format } from "date-fns";

/**
 * 时间的唯一换算入口。
 *
 * 契约：后端与 D1 里存的一律是 UTC；界面上显示和编辑的一律是阅读者本地时间。
 * 两边的换算只能从这个文件出——散在各处自己写，迟早会在三处分叉：
 *
 *  1. 偏移的符号。`Date.getTimezoneOffset()` 是「本地比 UTC 少多少分钟」，
 *     UTC+8 拿到的是 -480。仓库里两处曾各按一种符号写，读代码的人无从判断
 *     某个 offsetMinutes 参数要的是哪一种。这里统一成东为正（UTC+8 → +480），
 *     取值只经 viewerUtcOffsetMinutes()。
 *  2. 「今天」。`toISOString().slice(0, 10)` 取的是 UTC 那天，不是阅读者那天。
 *     UTC+8 的晚上八点之后，这两个日期就差一天。要本地日期用 localDateKey()。
 *  3. <input type="datetime-local"> 的值。它是一个不带时区的本地挂钟串，
 *     既不是 ISO 也不能直接塞回后端，来回都必须过 toDateTimeLocalValue /
 *     fromDateTimeLocalValue。
 */

/** 无效或缺失的时间统一显示成这个，不显示 Invalid Date，也不静默显示空白。 */
export const EMPTY_TIME_TEXT = "-";

export type Instant = string | number | Date | null | undefined;

/**
 * 阅读者当前的 UTC 偏移，分钟，**东为正**（UTC+8 → +480）。
 *
 * 注意与 `Date.getTimezoneOffset()` 符号相反。取的是「此刻」的偏移：对于带日期的
 * 瞬时点，Date 自己会按那一天的夏令时换算，用不着这个函数；只有周作息、每周固定
 * 开始时间这类「没有日期的挂钟」才需要它，而那种数据本来就说不清夏令时切换落在
 * 哪一周，只能按此刻的偏移读。
 */
export function viewerUtcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** 阅读者的 IANA 时区名，用于在界面上说明「这些时刻按谁的表读」。 */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 解析成 Date；解析不出来返回 null，让调用方自己决定显示什么。 */
export function toDate(value: Instant): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* ── 显示：瞬时点 → 阅读者本地 ─────────────────────────────────────────
   Date 的 getFullYear / getHours 一族本来就按本地时区取值，所以这里不做位移，
   只负责统一「格式」和「无效时显示什么」。 */

/** `2026-08-13 19:12`。可排序、与语言无关，用于日志、审计、版本这类记录。 */
export function formatDateTime(value: Instant): string {
  const date = toDate(value);
  return date ? format(date, "yyyy-MM-dd HH:mm") : EMPTY_TIME_TEXT;
}

/** `19:12`，或带秒的 `19:12:45`。一律 24 小时制。 */
export function formatClock(value: Instant, options?: { seconds?: boolean }): string {
  const date = toDate(value);
  if (!date) return EMPTY_TIME_TEXT;
  return format(date, options?.seconds ? "HH:mm:ss" : "HH:mm");
}

export type EventTimeFormatOptions = {
  /** 省略时按阅读者浏览器时区显示；测试或固定场景可显式指定。 */
  timeZone?: string;
  hour12?: boolean;
};

function eventTimeFormatOptions(options: EventTimeFormatOptions): Intl.DateTimeFormatOptions {
  return {
    hour: "numeric",
    minute: "2-digit",
    ...(options.hour12 === undefined ? {} : { hour12: options.hour12 }),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  };
}

/** 指定瞬时点的短时区名；页面不得各自重新拼装 Intl 选项。 */
export function formatTimeZoneAbbreviation(value: Instant, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return timeZone ?? "";

  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone ?? "";
}

/** 绝对日期时间紧跟阅读者当前时区，供公告、记录等不属于活动日程的时间点使用。 */
export function formatDateTimeWithTimeZone(value: Instant): string {
  const date = toDate(value);
  if (!date) return EMPTY_TIME_TEXT;

  const timeZone = formatTimeZoneAbbreviation(date);
  const dateTime = formatDateTime(date);
  return timeZone ? `${dateTime} ${timeZone}` : dateTime;
}

/** 活动时刻始终把实际时区缩写紧跟在时间后，避免把服务器 UTC 误称为成员时区。 */
export function formatEventTime(
  value: Instant,
  locale: string | undefined,
  options: EventTimeFormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return EMPTY_TIME_TEXT;

  const time = date.toLocaleTimeString(locale, eventTimeFormatOptions(options));
  const timeZone = formatTimeZoneAbbreviation(date, options.timeZone);
  return timeZone ? `${time} ${timeZone}` : time;
}

/** 活动起止区间中的每个可见时刻都带自己的时区缩写，夏令时切换也不会被掩盖。 */
export function formatEventTimeRange(
  start: Instant,
  end: Instant,
  locale: string | undefined,
  options: EventTimeFormatOptions = {},
): string {
  if (!toDate(start)) return EMPTY_TIME_TEXT;
  const startTime = formatEventTime(start, locale, options);
  if (!toDate(end)) return startTime;
  return `${startTime}–${formatEventTime(end, locale, options)}`;
}

/**
 * numeric 不是 Intl 的 dateStyle，是 `toLocaleDateString()` 不带参数时的那种纯数字
 * 日期（8/13/2026）。站里好几处本来就长这样，给它一个名字，省得为了保形又各写一遍选项。
 */
export type LocaleDateStyle = "numeric" | "short" | "medium" | "long";

/* dateStyle/timeStyle 不能和 year/month/hour 这类分量选项混用，混了 Intl 直接抛。
   所以两半各自成套地给，不做合并。 */
function localeDateOptions(style: LocaleDateStyle): Intl.DateTimeFormatOptions {
  return style === "numeric"
    ? { year: "numeric", month: "numeric", day: "numeric" }
    : { dateStyle: style };
}

function localeTimeOptions(style: LocaleDateStyle): Intl.DateTimeFormatOptions {
  return style === "numeric" ? { hour: "2-digit", minute: "2-digit" } : { timeStyle: "short" };
}

/**
 * 按界面语言排的日期，给读者看的场合用它（资料、徽章、活动）。
 *
 * locale 允许省略：审计原始值这类地方要的就是浏览器默认语言，不跟界面语言走。
 */
export function formatLocaleDate(
  value: Instant,
  locale: string | undefined,
  style: LocaleDateStyle = "medium",
): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString(locale, localeDateOptions(style)) : EMPTY_TIME_TEXT;
}

/** 按界面语言排的日期 + 时刻。 */
export function formatLocaleDateTime(
  value: Instant,
  locale: string | undefined,
  style: LocaleDateStyle = "medium",
): string {
  const date = toDate(value);
  if (!date) return EMPTY_TIME_TEXT;
  return date.toLocaleString(locale, { ...localeDateOptions(style), ...localeTimeOptions(style) });
}

/**
 * 日历日期串 → UTC 午夜的 Date；不是 `YYYY-MM-DD`、或那天根本不存在都返回 null。
 *
 * 钉 UTC 不是「用 UTC 显示」，是「这个值本来就没有时区，别给它安一个」：请假从 8 月
 * 13 日起就是 8 月 13 日，与阅读者在哪个时区无关。按本地午夜造，再交给别处按 UTC 读
 * （或反过来），西半球的读者就会看成 12 日。
 */
function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  /* Date 会把 2 月 30 号顺延成 3 月 2 号。回读一遍才能判掉不存在的日子，否则输入框里
     打了一半的日期会显示成一个真实存在、但并非用户所打的那天。 */
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** 日历日期（`YYYY-MM-DD`，如请假起止）按字面显示，不做换算。 */
export function formatCalendarDate(
  value: string | null | undefined,
  locale: string | undefined,
  style: LocaleDateStyle = "medium",
): string {
  if (!value) return EMPTY_TIME_TEXT;
  const date = parseCalendarDate(value);
  return date
    ? date.toLocaleDateString(locale, { ...localeDateOptions(style), timeZone: "UTC" })
    : value;
}

/**
 * 日历日期按语言取部件，同样不做换算。
 *
 * 认不出就交白：这是给日期输入框的叠层用的，值打到一半时要让占位符顶上，
 * 而不是显示 EMPTY_TIME_TEXT 或一个猜出来的日子。
 */
export function formatCalendarParts(
  value: string | null | undefined,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value ? parseCalendarDate(value) : null;
  return date ? date.toLocaleDateString(locale, { ...options, timeZone: "UTC" }) : "";
}

/**
 * 按界面语言取日期的某几个部件（星期、月份简称等）。
 *
 * 留这个口子是因为日历、活动卡要的是「AUG」「周四」这种碎片，不是一整条日期；
 * 但它仍旧走同一套「无效返回占位」的规矩，且只接受 Intl 的选项，不接受自造格式。
 */
export function formatLocaleParts(
  value: Instant,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  return date ? date.toLocaleString(locale, options) : EMPTY_TIME_TEXT;
}

/* ── 日期键：阅读者当天，不是 UTC 当天 ──────────────────────────────── */

/**
 * 阅读者时区里的 `YYYY-MM-DD`，用于按天分组、日期输入框的默认值与上下界。
 *
 * 不传参数就是「今天」。别再写 `toISOString().slice(0, 10)`：那取的是 UTC 那天，
 * 东八区一过晚上八点就比阅读者的日历早一天，请假起止、战史按天分组都会错位。
 */
export function localDateKey(value?: Instant): string {
  const date = value === undefined ? new Date() : toDate(value);
  return date ? format(date, "yyyy-MM-dd") : EMPTY_TIME_TEXT;
}

/* ── <input type="datetime-local"> / <input type="date"> ────────────── */

/** 瞬时点 → `yyyy-MM-ddTHH:mm`，即 datetime-local 控件要的本地挂钟串。 */
export function toDateTimeLocalValue(value: Instant): string {
  const date = toDate(value);
  return date ? format(date, "yyyy-MM-dd'T'HH:mm") : "";
}

/**
 * datetime-local 控件的值 → 存回后端的 UTC ISO 串。
 *
 * 只认完整的 `yyyy-MM-ddTHH:mm`，按本地挂钟逐段解析——用户填的是自己表上的时刻。
 * 不能图省事丢给 `new Date(串)`：`"2026-08"` 在它眼里是合法的，会当成 UTC 八月一号
 * 零点，一口气编出日、时和时区三样东西。填不全就返回 undefined，让调用方把这个字段
 * 整个略过，而不是存进一个猜出来的时刻。
 */
export function fromDateTimeLocalValue(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return undefined;
  const date = new Date(year, month - 1, day, hour, minute, Number(match[6] ?? 0));
  /* 只回读日期那三段：2 月 30 号该判掉，而夏令时跳过的那个钟点（本地 02:30 直接
     变成 03:30）是平台的正常归一，控件真会给出来，不该连值一起丢掉。 */
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return undefined;
  }
  return date.toISOString();
}


/* ── 存量 ISO 串的校验与兜底 ────────────────────────────────────────── */

/** 这个串能不能当成时间读。用于校验从 localStorage 或推送消息里拿到的值。 */
export function isIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

/**
 * 读不出时间就取此刻。
 *
 * 只用在通知的「上次看到」这类游标上：那里必须有一个时间点才能比较新旧，取此刻
 * 的后果是把当前这批当成已读，比留一个空值让整套比较逻辑失效要好。别拿它兜别处
 * 的坏数据——业务字段读不出来时该显示 EMPTY_TIME_TEXT，不是悄悄换成现在。
 */
export function toIsoOrNow(value: string | undefined): string {
  return value && isIsoDate(value) ? value : new Date().toISOString();
}

/* ── 挂钟：没有日期的 "HH:mm"，UTC ↔ 本地 ───────────────────────────── */

const DAY_MINUTES = 24 * 60;

/**
 * `"HH:mm"` → 自午夜起的分钟数；不是合法挂钟就返回 null。
 *
 * 给需要拿到数值的调用方用（重复模板要把开始时刻交给 computeNextOccurrenceFromCursor）。
 * 换算本身别在外面做，把串先过 utcClockToLocal / localClockToUtc 再解析。
 */
export function parseClockMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatClockMinutes(minutes: number): string {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * 存着的 UTC 挂钟 → 阅读者本地挂钟。跨午夜自动绕回。
 *
 * 认不出的串原样返回：坏数据要留在界面上被看见，不能被换算悄悄改成一个像样的时刻。
 * 只挪时刻、不带星期——星期要一起挪的场合（周作息用 utils/availability，每周重复
 * 规则用 @guild/shared 的 utcWeekdayToLocal）另有出口。
 */
export function utcClockToLocal(time: string): string {
  const minutes = parseClockMinutes(time);
  return minutes === null ? time : formatClockMinutes(minutes + viewerUtcOffsetMinutes());
}

/** 本地填的挂钟 → 存回后端的 UTC 挂钟。utcClockToLocal 的逆。 */
export function localClockToUtc(time: string): string {
  const minutes = parseClockMinutes(time);
  return minutes === null ? time : formatClockMinutes(minutes - viewerUtcOffsetMinutes());
}

export const WEEK_MINUTES = 7 * DAY_MINUTES;

/** 把「星期几 + 当天第几分钟」压成一周里的分钟数，并绕回 0..WEEK_MINUTES。 */
export function wrapWeekMinute(value: number): number {
  return ((value % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
}
