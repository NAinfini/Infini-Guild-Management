import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const transitionFiles = [
  "apps/portal/components/pages/EventsPage.impl.tsx",
  "apps/portal/components/pages/GuildWarPage.impl.tsx",
  "apps/portal/components/pages/AdminPage.impl.tsx",
  "apps/worker/routes/events.impl.ts",
  "apps/worker/routes/guild-war.impl.ts",
  "apps/worker/routes/admin.impl.ts",
];

const canonicalFiles = [
  "apps/portal/components/pages/EventsPage.tsx",
  "apps/portal/components/pages/GuildWarPage.tsx",
  "apps/portal/components/pages/AdminPage.tsx",
  "apps/worker/routes/events.ts",
  "apps/worker/routes/guild-war.ts",
  "apps/worker/routes/admin.ts",
];

const legacyComponentFiles = [
  "apps/portal/components/pages/AnnouncementsPage.tsx",
  "apps/portal/components/pages/DashboardPage.tsx",
  "apps/portal/components/pages/GalleryPage.tsx",
  "apps/portal/components/pages/MyProfilePage.tsx",
  "apps/portal/components/pages/RosterPage.tsx",
  "apps/portal/components/pages/WikiPage.tsx",
  "apps/portal/components/layout/AppShell.tsx",
  "apps/portal/components/feature/admin/AdminAuditSection.tsx",
  "apps/portal/components/feature/admin/AdminInviteSection.tsx",
  "apps/portal/components/feature/admin/AdminMemberDetailModal.tsx",
  "apps/portal/components/feature/admin/AdminMemberMediaTab.tsx",
  "apps/portal/components/feature/admin/AdminUsersSection.tsx",
  "apps/portal/components/feature/admin/AuditLogViewer.tsx",
  "apps/portal/components/feature/events/RecurringTemplatesTab.tsx",
  "apps/portal/components/feature/gallery/shared.ts",
];

const legacyPageFiles = [
  "apps/portal/components/pages/EventsPage.tsx",
  "apps/portal/components/pages/GuildWarPage.tsx",
  "apps/portal/components/pages/AdminPage.tsx",
];

function resolveRepoPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

describe("legacy cleanup", () => {
  it("does not keep targeted transition impl files", () => {
    for (const relativePath of transitionFiles) {
      expect(fs.existsSync(resolveRepoPath(relativePath)), `${relativePath} should be removed`).toBe(false);
    }
  });

  it("keeps canonical files as direct implementations", () => {
    for (const relativePath of canonicalFiles) {
      const fileContent = fs.readFileSync(resolveRepoPath(relativePath), "utf8");
      expect(fileContent, `${relativePath} should not re-export a .impl file`).not.toContain(".impl");
    }
  });

  it("keeps migrated legacy-components off portal API modules", () => {
    for (const relativePath of legacyComponentFiles) {
      const fileContent = fs.readFileSync(resolveRepoPath(relativePath), "utf8");
      expect(fileContent, `${relativePath} should not import portal api modules directly`).not.toMatch(
        /api\/(mutations|queries|query-keys|client)/,
      );
    }
  });

  it("keeps migrated legacy-pages off portal API modules", () => {
    for (const relativePath of legacyPageFiles) {
      const fileContent = fs.readFileSync(resolveRepoPath(relativePath), "utf8");
      expect(fileContent, `${relativePath} should not import portal api modules directly`).not.toMatch(
        /api\/(mutations|queries|query-keys|client)/,
      );
    }
  });
});
