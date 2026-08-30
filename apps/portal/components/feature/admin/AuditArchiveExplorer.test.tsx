import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@portal/api/client";
import { AuditArchiveExplorer } from "./AuditArchiveExplorer";

const serviceMocks = vi.hoisted(() => ({
  fetchAdminAuditArchiveFiles: vi.fn(),
  downloadAdminAuditArchiveFile: vi.fn(),
}));
const presentAppError = vi.hoisted(() => vi.fn());

vi.mock("../../../services/AdminService", () => serviceMocks);
vi.mock("../../../utils/admin", () => ({ downloadFileBlob: vi.fn() }));
vi.mock("../../../utils/notifications", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("../../../hooks/useAppError", () => ({ presentAppError }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("AuditArchiveExplorer", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) mock.mockReset();
    presentAppError.mockReset();
  });

  it("delegates an archive download network failure to the shared error presenter", async () => {
    const networkFailure = new ApiRequestError("Network unavailable", { status: 0 });
    serviceMocks.fetchAdminAuditArchiveFiles.mockRejectedValue(networkFailure);
    const user = userEvent.setup();
    render(
      <AuditArchiveExplorer
        months={["2026-08"]}
        monthsLoading={false}
        monthsError={false}
        onRetryMonths={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "auditArchive.toggleShow" }));
    await user.click(screen.getByRole("combobox", { name: "auditArchive.monthLabel" }));
    await user.click(await screen.findByRole("option", { name: "2026-08" }));
    await user.click(screen.getByRole("button", { name: "auditArchive.downloadRaw" }));

    await waitFor(() => expect(presentAppError).toHaveBeenCalledWith(
      networkFailure,
      "message.archiveRawDownloadFailed",
    ));
  });
});
