import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBeforeUnloadPrompt } from "./useBeforeUnloadPrompt";

const blockerMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useBlocker: blockerMock,
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("useBeforeUnloadPrompt", () => {
  beforeEach(() => {
    blockerMock.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(false);
  });

  it("allows opted-in same-path navigation but still blocks leaving the page", async () => {
    renderHook(() =>
      useBeforeUnloadPrompt(true, {
        allowSamePathNavigation: true,
      }),
    );

    const options = blockerMock.mock.calls[0]?.[0];
    expect(options.enableBeforeUnload).toBe(true);
    expect(
      await options.shouldBlockFn({
        current: { pathname: "/profile" },
        next: { pathname: "/profile" },
        action: "PUSH",
      }),
    ).toBe(false);
    expect(confirmMock).not.toHaveBeenCalled();

    expect(
      await options.shouldBlockFn({
        current: { pathname: "/profile" },
        next: { pathname: "/events" },
        action: "PUSH",
      }),
    ).toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
