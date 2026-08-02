import { describe, expect, it } from "vitest";
import {
  EVENTS_ROUTE_SEARCH_SCHEMA,
  buildEventWorkbenchSearch,
  clearEventWorkbenchFocus,
  resolveEventsViewMode,
  sanitizeEventsRouteSearch,
} from "./event-navigation";

describe("event navigation", () => {
  it("uses eventId as the sole detail-restoration state", () => {
    expect(
      buildEventWorkbenchSearch({
        id: "event-42",
        title: "Guild Raid",
      }),
    ).toEqual({
      eventId: "event-42",
      view: "cards",
    });
  });

  it("keeps cards view explicit while removing empty filters", () => {
    expect(
      sanitizeEventsRouteSearch({
        search: "   ",
        type: undefined,
        pinned: false,
        locked: false,
        eventId: "   ",
        view: "cards",
      }),
    ).toEqual({
      view: "cards",
    });
  });

  it("preserves active filters that should stay shareable in the URL", () => {
    expect(
      sanitizeEventsRouteSearch({
        search: "Guild Raid",
        type: "guild_war",
        status: "archived",
        pinned: true,
        locked: true,
        eventId: "event-42",
        view: "month",
      }),
    ).toEqual({
      search: "Guild Raid",
      type: "guild_war",
      status: "archived",
      pinned: true,
      locked: true,
      eventId: "event-42",
      view: "month",
    });
  });

  it("keeps all status explicit because it changes server filtering", () => {
    expect(sanitizeEventsRouteSearch({ status: "all" })).toEqual({ status: "all" });
  });

  it("clears only the modal focus when a deep-linked detail closes", () => {
    expect(
      clearEventWorkbenchFocus({
        search: "Guild Raid",
        eventId: "event-42",
        view: "cards",
        pinned: true,
      }),
    ).toEqual({
      search: "Guild Raid",
      view: "cards",
      pinned: true,
    });
  });

  it("survives the router's JSON-parsed search params instead of blowing up the route", () => {
    /*
     * TanStack Router 把 ?search=20260731 解析成 number、?search=true 解析成 boolean。
     * validateSearch 一抛错就是整页错误边界，所以这些值必须被接住而不是被拒绝。
     */
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ search: 20260731 })).toEqual({ search: "20260731" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ search: true })).toEqual({ search: "true" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ eventId: 42 })).toEqual({ eventId: "42" });
    // 认不出来的筛选值一律当成没填，和 status/tab/view 的处理保持一致。
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ type: 1 })).toEqual({});
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ type: "not_a_type" })).toEqual({});
  });

  /*
   * 周期模板从独立标签页并入 view 之后，tab 只剩「翻译旧链接」这一个职责：
   * 读得进来，但绝不写回 URL。已经发出去的 /events?tab=recurring 必须还能落到
   * 模板视图，否则那些链接会静默退回卡片视图——看上去正常，其实去错了地方。
   */
  it("resolves the view identically on the read path and the write path", () => {
    /*
     * 这条是照着一次真实的漏改立的：翻译只做在 sanitize（写路径）上，而页面渲染
     * 读的是没翻译过的 search.view，于是 /events?tab=recurring 静默退回卡片视图。
     * 两条路径必须由同一个函数决定，任何一边单独改都会被这里拦下。
     */
    const legacy = { tab: "recurring" } as const;
    expect(resolveEventsViewMode(legacy)).toBe("recurring");
    expect(sanitizeEventsRouteSearch(legacy).view).toBe(resolveEventsViewMode(legacy));

    const explicit = { tab: "recurring", view: "month" } as const;
    expect(sanitizeEventsRouteSearch(explicit).view).toBe(resolveEventsViewMode(explicit));

    expect(resolveEventsViewMode({})).toBeUndefined();
    expect(resolveEventsViewMode({ tab: "events" })).toBeUndefined();
  });

  it("translates the legacy tab param into the recurring view and never writes it back", () => {
    expect(sanitizeEventsRouteSearch({ tab: "recurring" })).toEqual({ view: "recurring" });
    expect(sanitizeEventsRouteSearch({ tab: "events", view: "cards" })).toEqual({ view: "cards" });
    // 显式的 view 优先：它才是这套 UI 会写出来的那个参数。
    expect(sanitizeEventsRouteSearch({ tab: "recurring", view: "month" })).toEqual({ view: "month" });
    expect(EVENTS_ROUTE_SEARCH_SCHEMA.parse({ view: "recurring" })).toEqual({ view: "recurring" });
  });
});
