import type { RecurringTemplate } from "@guild/shared";
import { screen, within } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringTemplatesTab } from "./RecurringTemplatesTab";

const confirmMock = vi.hoisted(() => vi.fn());

if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "recurring.editAria" ? `Edit ${options?.title}` : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

function buildTemplate(overrides: Partial<RecurringTemplate>): RecurringTemplate {
  return {
    id: "template-1",
    type: "weekly_mission",
    title: "Weekly Mission",
    description: "Team strategy session",
    start_time: "12:00",
    duration_minutes: 60,
    capacity: 20,
    recurrence_rule: {
      frequency: "weekly",
      interval: 1,
      daysOfWeek: [1],
    },
    visibility_offset_minutes: 0,
    auto_archive: false,
    attachments: [],
    class_quotas: [],
    paused: false,
    created_by: "user-1",
    last_generated_date: null,
    generation_count: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("RecurringTemplatesTab", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1200, 48),
    );
    confirmMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps search, filters, and creation in one template toolbar", () => {
    render(
      <>
        <RecurringTemplatesTab
          canManage
          templates={[buildTemplate({})]}
          loading={false}
          onCreateTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
        />
      </>,
    );

    const search = screen.getByRole("textbox", { name: "recurring.filter.search" });
    const filterToggle = screen.getByRole("button", { name: "common:filter.toggle" });
    const create = screen.getByRole("button", { name: "recurring.create" });
    expect(filterToggle.closest(".content-filter-toolbar")).toBe(search.closest(".content-filter-toolbar"));
    expect(create.closest(".content-filter-toolbar")).toBe(search.closest(".content-filter-toolbar"));
    expect(screen.queryByRole("radio", { name: "view.recurring" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "view.events" })).not.toBeInTheDocument();
  });

  it("keeps the template toolbar available when there is not a single template yet", async () => {
    const user = userEvent.setup();
    const onCreateTemplate = vi.fn();

    render(
      <>
        <RecurringTemplatesTab
          canManage
          templates={[]}
          loading={false}
          onCreateTemplate={onCreateTemplate}
          onEditTemplate={vi.fn()}
        />
      </>,
    );

    expect(screen.getByRole("textbox", { name: "recurring.filter.search" })).toBeVisible();
    expect(screen.getByRole("button", { name: "common:filter.toggle" })).toBeVisible();
    expect(screen.getByRole("button", { name: "recurring.create" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "recurring.create" }));
    expect(onCreateTemplate).toHaveBeenCalledOnce();
  });

  it("searches templates and filters them by status and event type", async () => {
    const user = userEvent.setup();
    const activeTemplate = buildTemplate({ id: "active", title: "Alpha Run" });
    const pausedTemplate = buildTemplate({
      id: "paused",
      type: "social",
      title: "Beta Social",
      description: "Guild meetup",
      paused: true,
    });

    render(
      <>
        <RecurringTemplatesTab
          canManage
          templates={[activeTemplate, pausedTemplate]}
          loading={false}
          onCreateTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
        />
      </>,
    );

    const searchInput = screen.getByRole("textbox", { name: "recurring.filter.search" });
    await user.type(searchInput, "alpha");
    expect(screen.getByText("Alpha Run")).toBeInTheDocument();
    expect(screen.queryByText("Beta Social")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common:action.clear" }));
    expect(searchInput).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "common:filter.toggle" }));
    const filterDialog = await screen.findByRole("dialog", { name: "common:filter.toggle" });
    await user.click(within(filterDialog).getByRole("button", { name: "recurring.status.paused" }));
    expect(screen.queryByText("Alpha Run")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Social")).toBeInTheDocument();

    const typeGroup = within(filterDialog).getByRole("radiogroup", { name: "recurring.filter.type" });
    await user.click(within(typeGroup).getByRole("radio", { name: "recurring.filter.all" }));
    await user.click(within(typeGroup).getByRole("radio", { name: "Social" }));
    expect(screen.queryByText("Alpha Run")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Social")).toBeInTheDocument();
  });

  it("navigates editable template cards with Enter or Space without opening a nested modal", async () => {
    const user = userEvent.setup();
    const onEditTemplate = vi.fn();

    render(
      <>
        <RecurringTemplatesTab
          canManage
          templates={[buildTemplate({})]}
          loading={false}
          onCreateTemplate={vi.fn()}
          onEditTemplate={onEditTemplate}
        />
      </>,
    );

    const templateCard = screen.getByRole("button", { name: "Edit Weekly Mission" });
    templateCard.focus();
    await user.keyboard("{Enter}");
    expect(onEditTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: "template-1" }));

    templateCard.focus();
    await user.keyboard(" ");
    expect(onEditTemplate).toHaveBeenCalledTimes(2);
    const statusControl = screen.getByRole("button", { name: "tooltip.templateActive.title" });
    await user.click(statusControl);
    expect(onEditTemplate).toHaveBeenCalledTimes(2);
  });
});
