import type { BotTask } from "@guild/shared";
import { EmbedBuilder, type APIEmbed, type MessageCreateOptions } from "discord.js";

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function formatDateTime(iso: string | null): string {
  if (!iso) {
    return "unknown time";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export type DiscordTaskMessage = Pick<MessageCreateOptions, "content" | "embeds">;

export function buildEventEmbed(payload: Record<string, unknown>): APIEmbed {
  const title = toStringValue(payload.title) ?? "Event";
  const eventType = toStringValue(payload.type) ?? "general";
  const startAt = formatDateTime(toStringValue(payload.start_at));
  const description = toStringValue(payload.description) ?? "-";
  const capacity = toNumber(payload.capacity);
  const eventId = toStringValue(payload.event_id);

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x5865f2)
    .setDescription(description.slice(0, 200))
    .addFields(
      { name: "Type", value: eventType, inline: true },
      { name: "Start", value: startAt, inline: true },
      { name: "Capacity", value: String(capacity ?? "unlimited"), inline: true },
    )
    .setFooter({ text: eventId ? `event:${eventId}` : "Guild Event" })
    .toJSON();
}

export function buildWarResultEmbed(payload: Record<string, unknown>): APIEmbed {
  const warName = toStringValue(payload.war_name) ?? "Guild War";
  const result = toStringValue(payload.result) ?? "unknown";
  const ownKills = toNumber(payload.own_kills) ?? 0;
  const enemyKills = toNumber(payload.enemy_kills) ?? 0;
  const ownCredits = toNumber(payload.own_credits) ?? 0;
  const enemyCredits = toNumber(payload.enemy_credits) ?? 0;
  const mvpDamage = toStringValue(payload.mvp_damage) ?? "-";
  const mvpHealing = toStringValue(payload.mvp_healing) ?? "-";

  const color = result.toLowerCase() === "win" ? 0x57f287 : result.toLowerCase() === "loss" ? 0xed4245 : 0x99aab5;

  return new EmbedBuilder()
    .setTitle(warName)
    .setColor(color)
    .addFields(
      { name: "Kills", value: `${ownKills} / ${enemyKills}`, inline: true },
      { name: "Credits", value: `${ownCredits} / ${enemyCredits}`, inline: true },
      { name: "MVP Damage", value: mvpDamage, inline: true },
      { name: "MVP Healing", value: mvpHealing, inline: true },
    )
    .toJSON();
}

function buildTeamCompMessage(payload: Record<string, unknown>): string {
  const title = toStringValue(payload.title) ?? "Team Composition";
  const teams = Array.isArray(payload.teams) ? payload.teams : [];
  const lines = teams
    .map((team) => {
      if (typeof team !== "object" || team === null) {
        return null;
      }
      const row = team as Record<string, unknown>;
      const teamName = toStringValue(row.team_name) ?? "Team";
      const members = Array.isArray(row.members)
        ? row.members
            .map((member) => {
              if (typeof member !== "object" || member === null) {
                return null;
              }
              const m = member as Record<string, unknown>;
              const username = toStringValue(m.username) ?? "-";
              const wechat = toStringValue(m.wechat_name);
              const roleTag = toStringValue(m.role_tag);
              return `@${wechat ?? username}${roleTag ? `(${roleTag})` : ""}`;
            })
            .filter((item): item is string => Boolean(item))
        : [];
      return `• ${teamName}: ${members.join(", ") || "no members"}`;
    })
    .filter((line): line is string => Boolean(line));

  return `${title}\n${lines.join("\n")}`;
}

export function formatDiscordTaskMessage(task: BotTask): DiscordTaskMessage {
  const payload = task.payload;
  const title = typeof payload.title === "string" ? payload.title : "Update";

  if (task.task_type === "reminder") {
    const startAt = formatDateTime(toStringValue(payload.start_at));
    const eventId = toStringValue(payload.event_id);
    return {
      content: [`Reminder: ${title}`, `Starts: ${startAt}`, eventId ? `event:${eventId}` : null]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    };
  }

  if (task.task_type === "war_result") {
    return {
      embeds: [buildWarResultEmbed(payload)],
    };
  }

  if (task.task_type === "team_comp") {
    return {
      content: buildTeamCompMessage(payload),
    };
  }

  return {
    embeds: [buildEventEmbed(payload)],
  };
}
