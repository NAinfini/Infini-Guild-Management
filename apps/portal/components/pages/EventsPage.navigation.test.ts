import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("EventsPage navigation architecture", () => {
  it("uses URL state and page tabs without a counter event bus", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/EventsPage.tsx"),
      "utf8",
    );

    expect(source).toContain("<PageTabs");
    expect(source).toContain('<PageTabPanel value="recurring"');
    expect(source).not.toContain("useLocalStorage");
    expect(source).not.toContain("EVENTS_VIEW_MODE_KEY");
    expect(source).not.toContain("createTemplateRequested");
    expect(source).not.toContain("setCreateTemplateRequested");
  });
});
