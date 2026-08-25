// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function pageSource(name: string): string {
  return readFileSync(resolve(process.cwd(), `apps/portal/components/pages/${name}`), "utf8");
}

function featureSource(name: string): string {
  return readFileSync(resolve(process.cwd(), `apps/portal/components/feature/events/${name}`), "utf8");
}

describe("event route pages", () => {
  it("makes an event detail a real queried page with a not-found state", () => {
    const source = pageSource("EventDetailPage.tsx");

    expect(source).toContain("fetchEventDetail(id)");
    expect(source).toContain("<EventDetailContent");
    expect(source).toContain("detailQuery.error.status === 404");
    expect(source).toContain("event-route-header--sticky");
    expect(source).toContain("event-route-header__back");
    expect(source).toContain("<h1>{event.title}</h1>");
    expect(source).toContain("detailQuery.refetch()");
    expect(source).not.toContain("EventDetailModal");
  });

  it("uses the existing event editor controller for create and edit route forms", () => {
    const source = pageSource("EventEditorPage.tsx");

    expect(source).toContain("useEventsEditorController");
    expect(source).toContain("<EventFormContent");
    expect(source).toContain("stickyActions");
    expect(source).toContain("initialDateKey");
    expect(source).toContain('t("editor.backToEvent")');
    expect(source).toContain('to: "/events/$id"');
    expect(source).toContain("event-route-header--sticky");
    expect(source).toContain("event-route-header__back");
    expect(source).toContain("<h1>{mode === \"create\" ? t(\"editor.createTitle\") : t(\"editor.editTitle\")}</h1>");
    expect(source).toContain("replace: true");
    expect(source).toContain("detailQuery.refetch()");
    expect(source).not.toContain("<Paper");
    expect(source).not.toContain("EventFormModal");
  });

  it("uses two visible editor plates instead of one nested full-width form card", () => {
    const source = featureSource("EventFormContent.tsx");
    const styles = featureSource("EventFormContent.css");

    expect(source).toContain("event-form__panel--main");
    expect(source).toContain("event-form__panel--settings");
    expect(styles).toMatch(/\.event-form__panel\s*{[^}]*background:\s*var\(--plate-fill\)/s);
    expect(styles).toMatch(/\.event-form__panel\s*{[^}]*box-shadow:\s*var\(--edge-top\)/s);
    expect(styles).toMatch(/\.event-form__layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.55fr\)/s);
    expect(styles).toMatch(/@media \(max-width: 63\.99em\)[\s\S]*\.event-form__layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  });

  it("keeps route navigation visibly separated from the scenic background", () => {
    const styles = pageSource("EventsPage.css");

    expect(styles).toMatch(/\.event-route-header__back\s*{[^}]*background:\s*color-mix\(in srgb,\s*var\(--text-primary\)/s);
    expect(styles).toMatch(/\.event-route-header--sticky\s*{[^}]*box-shadow:\s*var\(--edge-top\)/s);
  });

  it("keeps attachment editor state out of list and detail pages", () => {
    const listSource = pageSource("EventsPage.tsx");
    const detailSource = pageSource("EventDetailPage.tsx");

    for (const source of [listSource, detailSource]) {
      expect(source).not.toContain("ImageGridEditorItem");
      expect(source).not.toContain("attachmentItems");
      expect(source).not.toContain("closeEditorAfterSave");
    }
  });

  it("routes calendar date selection through the URL-backed event filtering controller", () => {
    const source = pageSource("EventsPage.tsx");

    expect(source).toContain("selectedDateKey={filtering.selectedDateKey}");
    expect(source).toContain("onSelectDate={filtering.setSelectedDate}");
    expect(source).not.toContain("onSelectDate={() => {}}");
  });

  it("keeps recurring lifecycle editing on a route with one dirty-navigation guard", () => {
    const source = pageSource("RecurringTemplateEditorPage.tsx");

    expect(source).toContain("useRecurringTemplatesController");
    expect(source).toContain("useBeforeUnloadPrompt(isDirty && !saved)");
    expect(source).toContain("<RecurringTemplateFormContent");
    expect(source).toContain("event-route-header--sticky");
    expect(source).toContain("recurring-template-editor-page__status");
    expect(source).toContain("<h1>{mode === \"create\" ? t(\"recurring.create\") : t(\"recurring.edit\")}</h1>");
    expect(source).toContain("controller.refetchTemplates()");
    expect(source).toContain("replace: true");
    expect(source).not.toContain("RecurringTemplateFormModal");
  });
});
