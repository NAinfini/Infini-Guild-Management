import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAdminInviteController } from "./useAdminInviteController";

vi.mock("./useDebouncedSearch", () => ({
  useDebouncedSearch: () => ({
    search: " AbCd_Ef-123 ",
    setSearch: vi.fn(),
    debouncedSearch: " AbCd_Ef-123 ",
  }),
}));

describe("useAdminInviteController", () => {
  it("preserves invite-search case while trimming the debounced search", () => {
    const { result } = renderHook(() => useAdminInviteController());

    expect(result.current.debouncedInviteSearch).toBe("AbCd_Ef-123");
  });
});
