import { screen } from "@testing-library/react";
import { renderWithQueryClient as render } from "@portal/tests/query-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveGuildWarMemberDetail } from "../../../hooks/guild-war/useGuildWarDragData";
import { WarMemberDetailModal } from "./WarMemberDetailModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.timezone === "string") return `${key}: ${options.timezone}`;
      return key;
    },
    i18n: { language: "en-US" },
  }),
}));

const detail: ActiveGuildWarMemberDetail = {
  display_name: "Alice",
  power: 8200,
  classes: [],
  titleHtml: null,
  availability: {
    timezone: "America/New_York",
    days: {
      sunday: [],
      monday: [{ start_utc: "23:00", end_utc: "24:00" }],
      tuesday: [],
      wednesday: [{ start_utc: "00:30", end_utc: "02:00" }],
      thursday: [],
      friday: [],
      saturday: [],
    },
  },
  vacationStart: "2026-08-20",
  vacationEnd: "2026-08-24",
  notes: "Prefers late-night wars",
};

function renderModal(canViewNotes: boolean, activeDetail = detail) {
  return render(
    <WarMemberDetailModal
      open
      activeDetailUserId="user-1"
      activeDetail={activeDetail}
      canViewNotes={canViewNotes}
      onClose={vi.fn()}
    />,
  );
}

describe("WarMemberDetailModal", () => {
  /* 钉死在 UTC+8 读这份作息。不钉的话断言里的时刻会跟着跑测试的机器变，
     而这条用例要守的正是「换算发生了」。 */
  beforeEach(() => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-480);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows scheduling details and protected notes without assignment or war stats", () => {
    renderModal(true);

    expect(screen.getByText("memberDetail.availability")).toBeInTheDocument();
    // UTC 周一 23:00–24:00 在 UTC+8 落到周二早上：星期必须跟着时刻一起挪。
    expect(screen.getByText("memberDetail.day.tuesday")).toBeInTheDocument();
    expect(screen.getByText(/^07:00–08:00 \S+$/)).toBeInTheDocument();
    expect(screen.getByText("memberDetail.day.wednesday")).toBeInTheDocument();
    expect(screen.getByText(/^08:30–10:00 \S+$/)).toBeInTheDocument();
    expect(screen.queryByText("memberDetail.day.monday")).not.toBeInTheDocument();
    expect(screen.queryByText(/^memberDetail\.viewerTimezone: /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^memberDetail\.profileTimezone: /)).not.toBeInTheDocument();
    expect(screen.getByText("memberDetail.vacation")).toBeInTheDocument();
    /* 请假起止是日历日期：不论阅读者在哪个时区，都必须显示写下的那两天。 */
    expect(screen.getByText("Aug 20, 2026 – Aug 24, 2026")).toBeInTheDocument();
    expect(screen.getByText("Prefers late-night wars")).toBeInTheDocument();

    expect(screen.queryByText("memberDetail.team")).not.toBeInTheDocument();
    expect(screen.queryByText("memberDetail.roleTag")).not.toBeInTheDocument();
    expect(screen.queryByText("memberDetail.statsHeader")).not.toBeInTheDocument();
  });

  it("hides the note section without permission and uses N/A for empty scheduling data", () => {
    renderModal(false, {
      ...detail,
      availability: null,
      vacationStart: null,
      vacationEnd: null,
      notes: null,
    });

    expect(screen.getAllByText("memberDetail.notAvailable")).toHaveLength(2);
    expect(screen.queryByText("memberDetail.note")).not.toBeInTheDocument();
  });
});
