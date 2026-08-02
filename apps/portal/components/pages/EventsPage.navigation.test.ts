import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("EventsPage navigation architecture", () => {
  /*
   * 卡片、月、周期模板现在是同一个 view 参数的三档，页面不再有第二层标签导航。
   * 断言里保留「只挂当前这一档」这条：原先由 Tabs 的 keepMounted={false} 保证，
   * 现在由三元分支保证——周期模板那棵树带自己的查询，被无条件挂上去就会白拉数据。
   */
  it("drives every view from the URL without a second tab layer or a counter event bus", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/EventsPage.tsx"),
      "utf8",
    );

    // 视图必须走共用的折算函数，页面自己再解析一遍 search.view 就会跟写路径分叉。
    expect(source).toContain("resolveEventsViewMode(eventsRouteSearch)");
    expect(source).toContain('viewMode === "recurring" ? (');
    expect(source).toContain('canManage && viewMode === "recurring"');
    expect(source).not.toContain("<Tabs");
    expect(source).not.toContain("PageTabs");
    expect(source).not.toContain("useLocalStorage");
    expect(source).not.toContain("EVENTS_VIEW_MODE_KEY");
    expect(source).not.toContain("createTemplateRequested");
    expect(source).not.toContain("setCreateTemplateRequested");
  });

  it("derives the detail modal from eventId and clears that URL state on close", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/EventsPage.tsx"),
      "utf8",
    );

    expect(source).toContain("filtering.focusedEvent");
    expect(source).toContain("filtering.clearFocusedEvent");
    expect(source).toContain("event={routeDetailEvent ?? monthDetailEvent}");
  });
});
