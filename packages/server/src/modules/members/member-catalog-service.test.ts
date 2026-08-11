import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { ClassTagUsageReader, MemberMediaPort, MembersStore } from "./member-types";
import { MemberCatalogService } from "./member-catalog-service";

const NOW = "2026-08-09T12:00:00.000Z";

describe("MemberCatalogService badge labels", () => {
  it("uses the profile-title sanitizer and rejects an empty sanitized label", async () => {
    const createBadge = vi.fn();
    const service = new MemberCatalogService({
      store: { createBadge } as unknown as MembersStore,
      media: {} as MemberMediaPort,
      tagUsage: {} as ClassTagUsageReader,
    });
    const context = createRequestContext({
      requestId: "request-1", now: NOW,
      authorization: createAuthorizationContext({
        userId: "admin", sessionId: "session", roleId: "admin", roleLevel: 900,
        permissions: [PERMISSION_ID.ADMIN_BADGES_MANAGE],
      }),
    });

    await expect(service.createBadge(context, { name: "Badge", label_html: '<img src="x">' }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(createBadge).not.toHaveBeenCalled();
  });
});
