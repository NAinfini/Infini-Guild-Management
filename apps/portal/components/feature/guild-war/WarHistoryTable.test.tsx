// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HistorySummaryRow } from "@portal/types/guild-war";
import { WarHistoryTable } from "./WarHistoryTable";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string; page?: number }) => {
      if (values?.name) return `${key}: ${values.name}`;
      if (values?.page) return `${key}: ${values.page}`;
      return key;
    },
  }),
}));

const historyRow: HistorySummaryRow = {
  id: "history-1",
  war_name: "War Session E",
  enemy_name: "Storm Vanguard",
  result: "win",
  created_at: "2026-07-29T08:16:00.000Z",
  own_stats: { kills: 35 },
  enemy_stats: { kills: 28 },
};

function HistoryTableHarness({
  onRowClick,
  historyPage = 1,
  historyTotalPages = 1,
  activeHistoryId = null,
}: {
  onRowClick: (id: string) => void;
  historyPage?: number;
  historyTotalPages?: number;
  activeHistoryId?: string | null;
}) {
  return (
    <WarHistoryTable
      historyDateFrom=""
      historyDateTo=""
      onHistoryDateFromChange={vi.fn()}
      onHistoryDateToChange={vi.fn()}
      onClearDates={vi.fn()}
      historySearch=""
      onHistorySearchChange={vi.fn()}
      historyLoading={false}
      historyError={false}
      loadErrorMessage="load error"
      filteredHistoryRows={[historyRow]}
      historyRows={[historyRow]}
      historyTotal={1}
      activeHistoryId={activeHistoryId}
      highlightRowId={null}
      onRowClick={onRowClick}
      historyTotalPages={historyTotalPages}
      historyPage={historyPage}
      historyPerPage={10}
      onHistoryPageChange={vi.fn()}
      onHistoryPerPageChange={vi.fn()}
    />
  );
}

describe("WarHistoryTable rail", () => {
  it("colours only the result badge", () => {
    render(
      <MantineProvider>
        <HistoryTableHarness onRowClick={vi.fn()} />
      </MantineProvider>,
    );

    const item = screen.getByRole("listitem");
    expect(item).toHaveClass("war-history-rail-item");
    expect(item).not.toHaveAttribute("data-result");
    expect(item.querySelector(".war-history-rail-item__stripe")).toBeNull();
    expect(
      within(item).getByText("Win").closest('[data-variant="light"]'),
    ).not.toBeNull();
  });

  it("renders one rail row per record that opens the full detail", async () => {
    const onRowClick = vi.fn();

    render(
      <MantineProvider>
        <HistoryTableHarness onRowClick={onRowClick} />
      </MantineProvider>,
    );

    expect(
      screen.getByRole("list", { name: "history.warList" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: "history.aria.openRecord: War Session E",
      }),
    );
    expect(onRowClick).toHaveBeenCalledWith("history-1");
  });

  it("marks the open record with aria-current so selection is not colour-only", () => {
    render(
      <MantineProvider>
        <HistoryTableHarness onRowClick={vi.fn()} activeHistoryId="history-1" />
      </MantineProvider>,
    );

    expect(
      screen.getByRole("button", { name: "history.aria.openRecord: War Session E" }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("offers no record selection — deletion is one record at a time from the detail pane", () => {
    render(
      <MantineProvider>
        <HistoryTableHarness onRowClick={vi.fn()} />
      </MantineProvider>,
    );

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("opens the native date picker from anywhere in the date filter", async () => {
    const showPicker = vi.fn();
    // jsdom has no showPicker; the component feature-detects it, so stub it on
    // the prototype to prove the click path calls it.
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      configurable: true,
      value: showPicker,
    });

    try {
      render(
        <MantineProvider>
          <HistoryTableHarness onRowClick={vi.fn()} />
        </MantineProvider>,
      );

      await userEvent.click(screen.getByLabelText("history.aria.dateFrom"));
      expect(showPicker).toHaveBeenCalledOnce();
    } finally {
      Reflect.deleteProperty(HTMLInputElement.prototype, "showPicker");
    }
  });

  it("labels every icon-only pagination control", () => {
    render(
      <MantineProvider>
        <HistoryTableHarness
          onRowClick={vi.fn()}
          historyPage={2}
          historyTotalPages={3}
        />
      </MantineProvider>,
    );

    [
      "history.aria.firstPage",
      "history.aria.previousPage",
      "history.aria.page: 1",
      "history.aria.page: 2",
      "history.aria.page: 3",
      "history.aria.nextPage",
      "history.aria.lastPage",
    ].forEach((name) => {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    });
  });
});
