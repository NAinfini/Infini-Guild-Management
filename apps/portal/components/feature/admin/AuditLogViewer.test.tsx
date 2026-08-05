// @vitest-environment jsdom
import type { AuditLogEntry } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AuditLogViewer } from "./AuditLogViewer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      if (key === "audit.relativeTime.daysAgo") return `${options?.count ?? 0}d ago`;
      if (key === "audit.action.upload") return "Uploaded";
      if (key === "audit.entityType.game_data") return "Game Data";
      if (key === "audit.detail.showFull") return "Show full";
      if (key === "audit.detail.showLess") return "Show less";
      if (key === "audit.detail.truncated") return "… (truncated)";
      return options?.defaultValue ?? key;
    },
  }),
}));

function makeAuditRow(id: string, detailText: string | null): AuditLogEntry {
  return {
    id,
    entity_type: "game_data",
    action: "upload",
    actor_id: "admin-user-id",
    actor_username: "GuildAdmin",
    entity_id: `game-data-${id}`,
    diff_title: "v1",
    detail_text: detailText,
    created_at: "2026-05-22T00:00:00.000Z",
  };
}

function renderAuditLogViewer(auditRows: AuditLogEntry[]) {
  render(
    <MantineProvider>
      <AuditLogViewer
        auditLoading={false}
        auditError={false}
        loadErrorMessage="Load failed"
        auditRows={auditRows}
        auditPageCurrent={1}
        auditPageSize={50}
        auditTotal={auditRows.length}
        onAuditPageChange={vi.fn()}
        isAdmin
        maskIdentifier={(value) => value}
        formatDateTime={(value) => value ?? ""}
      />
    </MantineProvider>,
  );
}

describe("AuditLogViewer", () => {
  it("uses regular pagination input sizing and a mobile hit-area token for filter chips", () => {
    renderAuditLogViewer([makeAuditRow("audit-controls", null)]);

    const pageInputRoot = screen.getByLabelText("pagination.page").closest(".mantine-NumberInput-root");
    expect(pageInputRoot).toHaveAttribute("data-size", "sm");

    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/AdminPage.css"),
      "utf8",
    );
    const mobileStart = css.indexOf("@media (max-width: 47.99em)");
    const nextMedia = css.indexOf("\n@media", mobileStart + 1);
    const mobileCss = css.slice(mobileStart, nextMedia === -1 ? undefined : nextMedia);
    expect(mobileCss).toMatch(
      /\.admin-filter-chip\s*\{[^}]*min-block-size:\s*var\(--control-hit-area\)/s,
    );
  });

  it("renders actor usernames from audit rows instead of raw actor ids", () => {
    renderAuditLogViewer([makeAuditRow("audit-1", null)]);

    expect(screen.getByText(/GuildAdmin Uploaded Game Data/)).toBeInTheDocument();
    expect(screen.queryByText(/admin-user-id Uploaded Game Data/)).not.toBeInTheDocument();
  });

  it("mounts a 20KB info value only after the user expands it", async () => {
    const user = userEvent.setup();
    const tail = "__INFO_VALUE_TAIL__";
    const longValue = `${"i".repeat(20 * 1024)}${tail}`;
    renderAuditLogViewer([makeAuditRow("audit-info", JSON.stringify({ notes: longValue }))]);

    await user.click(screen.getByRole("button", { name: /GuildAdmin Uploaded Game Data/ }));

    expect(document.body).not.toHaveTextContent(tail);
    const showFull = screen.getByRole("button", { name: "Show full" });
    expect(showFull).toHaveAttribute("aria-expanded", "false");

    await user.click(showFull);
    expect(document.body).toHaveTextContent(tail);
    const showLess = screen.getByRole("button", { name: "Show less" });
    expect(showLess).toHaveAttribute("aria-expanded", "true");

    await user.click(showLess);
    expect(document.body).not.toHaveTextContent(tail);
    expect(screen.getByRole("button", { name: "Show full" })).toHaveAttribute("aria-expanded", "false");
  });

  it("limits a 20KB diff value before explicit expansion", async () => {
    const user = userEvent.setup();
    const tail = "__DIFF_VALUE_TAIL__";
    const longValue = `${"d".repeat(20 * 1024)}${tail}`;
    renderAuditLogViewer([
      makeAuditRow("audit-diff", JSON.stringify({ description: { from: "short", to: longValue } })),
    ]);

    await user.click(screen.getByRole("button", { name: /GuildAdmin Uploaded Game Data/ }));
    expect(document.body).not.toHaveTextContent(tail);

    await user.click(screen.getByRole("button", { name: "Show full" }));
    expect(document.body).toHaveTextContent(tail);
  });

  it("limits invalid JSON detail text instead of mounting its full tail", async () => {
    const user = userEvent.setup();
    const tail = "__INVALID_JSON_TAIL__";
    const invalidDetail = `${"x".repeat(20 * 1024)}${tail}{`;
    renderAuditLogViewer([makeAuditRow("audit-invalid", invalidDetail)]);

    await user.click(screen.getByRole("button", { name: /GuildAdmin Uploaded Game Data/ }));
    expect(document.body).not.toHaveTextContent(tail);

    await user.click(screen.getByRole("button", { name: "Show full" }));
    expect(document.body).toHaveTextContent(tail);
  });

  it("renders short values unchanged without an expansion control", async () => {
    const user = userEvent.setup();
    renderAuditLogViewer([makeAuditRow("audit-short", JSON.stringify({ notes: "short value" }))]);

    await user.click(screen.getByRole("button", { name: /GuildAdmin Uploaded Game Data/ }));

    expect(screen.getByText("short value")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show full" })).not.toBeInTheDocument();
  });
});
