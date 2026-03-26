import type { BotTask } from "@guild/shared";

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toWechatMention(value: Record<string, unknown>): string {
  const wechatName = toStringValue(value.wechat_name);
  const username = toStringValue(value.username) ?? "member";
  return `@${wechatName ?? username}`;
}

export function buildWechatMessage(task: BotTask): string {
  const payload = task.payload;
  const title = toStringValue(payload.title) ?? "通知";

  if (task.task_type === "team_comp") {
    const teams = Array.isArray(payload.teams) ? payload.teams : [];
    const lines = teams
      .map((team) => {
        if (typeof team !== "object" || team === null) {
          return null;
        }
        const row = team as Record<string, unknown>;
        const teamName = toStringValue(row.team_name) ?? "队伍";
        const members = Array.isArray(row.members)
          ? row.members
              .map((member) => {
                if (typeof member !== "object" || member === null) {
                  return null;
                }
                return toWechatMention(member as Record<string, unknown>);
              })
              .filter((item): item is string => Boolean(item))
          : [];
        return `${teamName}: ${members.join("、") || "暂无成员"}`;
      })
      .filter((line): line is string => Boolean(line));
    return `${title}\n${lines.join("\n")}`;
  }

  if (task.task_type === "war_result") {
    const warName = toStringValue(payload.war_name) ?? title;
    const result = toStringValue(payload.result) ?? "未知";
    const ownKills = toNumber(payload.own_kills) ?? 0;
    const enemyKills = toNumber(payload.enemy_kills) ?? 0;
    return `${warName}\n结果: ${result}\n击杀: ${ownKills} / ${enemyKills}`;
  }

  if (task.task_type === "reminder") {
    const text = toStringValue(payload.text);
    const startAt = toStringValue(payload.start_at) ?? "即将开始";
    const mentionNames = Array.isArray(payload.mention_names)
      ? payload.mention_names.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    const lines = [
      text ?? `提醒: ${title}`,
      `开始时间: ${startAt}`,
      mentionNames.length > 0 ? `提醒对象: ${mentionNames.map((name) => `@${name}`).join("、")}` : null,
    ].filter((line): line is string => Boolean(line));
    return lines.join("\n");
  }

  return `${title}\n类型: ${toStringValue(payload.type) ?? "活动"}`;
}
