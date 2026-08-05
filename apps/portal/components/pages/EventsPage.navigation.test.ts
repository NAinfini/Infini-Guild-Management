import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("EventsPage navigation architecture", () => {
  // Mount only the active view; the recurring tree owns a query and must not fetch off-screen.
  it("drives every view from the URL without a second tab layer or a counter event bus", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/EventsPage.tsx"),
      "utf8",
    );

    // The page reads the same validated `view` field that navigation writes.
    expect(source).toContain('eventsRouteSearch.view ?? "cards"');
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
