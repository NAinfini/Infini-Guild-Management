import { describe, expect, it } from "vitest";
import type { EventViewerAggregate } from "@guild/server/modules/events";
import type { GuildWarAggregate } from "@guild/server/modules/guild-war";
import {
  guildWarActiveResponseSchema,
  guildWarAnalyticsResponseSchema,
  guildWarHistoryDetailResponseSchema,
} from "@guild/shared";
import {
  presentAnalytics,
  presentGuildWarActive,
  presentHistoryBatch,
  presentHistoryList,
  presentHistoryDetail,
} from "./guild-war-presenter.js";

const NOW = "2026-08-09T12:00:00.000Z";

const event: EventViewerAggregate = {
  event: {
    id: "event-1", type: "guild_war", title: "Week 1", description: null,
    startAt: NOW, endAt: null, capacity: null, pinned: false, signupLocked: false,
    autoArchive: false, autoArchived: false, visibleAt: null, archivedAt: null,
    createdBy: "admin-1", updatedBy: null, seriesId: null, instanceDate: null,
    winnerCount: null, createdAt: NOW, updatedAt: NOW,
  },
  attachments: [], classQuotas: [], poll: null, raffleWinners: [], participants: [],
};

function aggregate(status: "active" | "concluded"): GuildWarAggregate {
  return {
    war: {
      id: "war-1", eventId: "event-1", status, warName: "Week 1", enemyName: "Rivals", result: "win",
      ownStats: { kills: 10 }, enemyStats: { kills: 5 }, durationMinutes: 30, notes: null,
      rosterVersion: 2, concludedAt: status === "concluded" ? NOW : null,
      createdBy: "admin-1", updatedBy: null, createdAt: NOW, updatedAt: NOW,
    },
    teams: [{
      id: "team-1", warId: "war-1", teamName: "Alpha", sortOrder: 0, notes: null, isLocked: false,
      members: [{
        id: "member-1", warId: "war-1", teamId: "team-1", userId: "user-1", username: "One",
        roleTag: "Captain", sortOrder: 0, stats: { kills: 2, deaths: 1, assists: 3 }, note: null,
      }],
    }],
    pool: [{
      id: "pool-1", warId: "war-1", teamId: null, userId: "user-2", username: "Two",
      roleTag: null, sortOrder: 0, stats: null, note: null,
    }],
  };
}

describe("guild-war Portal presenters", () => {
  it("preserves active camel-case pool and team wire", () => {
    const active = aggregate("active");
    const parsed = guildWarActiveResponseSchema.parse(presentGuildWarActive({
      war: active.war,
      event,
      teams: active.teams,
      pool: active.pool,
      participants: [{ user_id: "user-1" }],
      etag: '"active-event-1-2"',
    }));
    expect(parsed.teams[0]).toMatchObject({ event_id: "event-1", war_history_id: null });
    expect(parsed.pool[0]).toMatchObject({ eventId: "event-1", warHistoryId: null, userId: "user-2" });
  });

  it("preserves history detail and analytics fixed-stat wire", () => {
    const history = aggregate("concluded");
    const detail = guildWarHistoryDetailResponseSchema.parse(presentHistoryDetail(history));
    expect(detail.teams[0]?.members[0]).toMatchObject({ user_id: "user-1", username: "One" });
    expect(detail.pool[0]).toMatchObject({ warHistoryId: "war-1", userId: "user-2", username: "Two" });
    const analytics = guildWarAnalyticsResponseSchema.parse(presentAnalytics({
      wars: [{ ...history.war, teamSize: 1, modifier: 2, modifierBreakdown: [{ factor: "kills", ratio: 2, weight: 1, contribution: 2 }] }],
      memberStats: [{ userId: "user-1", stats: { kills: 2, deaths: 1, assists: 3 } }],
      settings: { reference_duration_minutes: 30, modifier_weights: { kills: 1, towers: 0, base_hp: 0, credits: 0, distance: 0 } },
    }));
    expect(analytics.wars[0]).toMatchObject({ team_size: 1, modifier: 2 });
  });

  it("validates history list and batch envelopes at the presenter boundary", () => {
    const history = aggregate("concluded");
    expect(presentHistoryList({
      data: [history.war], total: 1, page: 1, limit: 20, total_pages: 1,
    })).toMatchObject({ total: 1, total_pages: 1 });
    expect(presentHistoryBatch([history]).data).toHaveLength(1);
  });
});
