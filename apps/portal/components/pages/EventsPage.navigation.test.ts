import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("EventsPage navigation architecture", () => {
  it("uses URL state and direct Mantine tabs without a counter event bus", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/EventsPage.tsx"),
      "utf8",
    );

    expect(source).toContain("<Tabs");
    expect(source).toContain("keepMounted={false}");
    expect(source).toContain('<Tabs.Panel value="recurring"');
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
