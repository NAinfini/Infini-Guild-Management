import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readPortalSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), "apps/portal", relativePath), "utf8");
}

describe("detail modal title fallbacks", () => {
  it("does not show generic fallback titles when nullable detail state is cleared during close", () => {
    const adminMemberDetail = readPortalSource("components/feature/admin/AdminMemberDetailModal.tsx");
    const warMemberDetail = readPortalSource("components/feature/guild-war/WarMemberDetailModal.tsx");
    const warHistoryDetail = readPortalSource("components/feature/guild-war/WarHistoryDetail.tsx");
    const profileModal = readPortalSource("components/shared/ProfileModal.tsx");

    expect(adminMemberDetail).not.toContain(
      'title={member ? t("detail.titleWithName", { username: member.user.username }) : t("detail.title")}',
    );
    expect(warMemberDetail).not.toContain(
      'title={activeDetailUserId ? t("memberDetail.title", { userId: activeDetailUserId }) : t("memberDetail.titleFallback")}',
    );
    expect(warHistoryDetail).not.toContain(
      'title={historyDetail ? `${historyDetail.war_name}${historyDetail.enemy_name ? ` ${t("history.versus")} ${historyDetail.enemy_name}` : ""}` : historyDetailTitle}',
    );
    expect(profileModal).not.toContain(
      '<span>{user ? t("profile.modalTitle", { name: user.username }) : t("profile.modalTitleFallback")}</span>',
    );
  });
});
