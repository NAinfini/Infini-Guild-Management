// @vitest-environment jsdom
import type { AuditLogEntry } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditLogViewer } from "./AuditLogViewer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      if (key === "audit.relativeTime.daysAgo") return `${options?.count ?? 0}d ago`;
      if (key === "audit.action.upload") return "Uploaded";
      if (key === "audit.entityType.game_data") return "Game Data";
      return options?.defaultValue ?? key;
    },
  }),
}));

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
        formatAuditDiffHeader={() => ""}
        formatDateTime={(value) => value ?? ""}
      />
    </MantineProvider>,
  );
}

describe("AuditLogViewer", () => {
  it("renders actor usernames from audit rows instead of raw actor ids", () => {
    renderAuditLogViewer([
      {
        id: "audit-1",
        entity_type: "game_data",
        action: "upload",
        actor_id: "admin-user-id",
        actor_username: "GuildAdmin",
        entity_id: "game-data-1",
        diff_title: "v1",
        detail_text: null,
        created_at: "2026-05-22T00:00:00.000Z",
      },
    ]);

    expect(screen.getByText(/GuildAdmin Uploaded Game Data/)).toBeInTheDocument();
    expect(screen.queryByText(/admin-user-id Uploaded Game Data/)).not.toBeInTheDocument();
  });
});
