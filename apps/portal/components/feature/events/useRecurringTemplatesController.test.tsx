// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../../services/EventService";
import { useRecurringTemplatesController } from "./useRecurringTemplatesController";

const notificationMocks = vi.hoisted(() => ({
  show: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  fetchTemplatesList: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  pauseTemplate: vi.fn(),
  resumeTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: notificationMocks,
}));

vi.mock("../../../services/EventService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/EventService")>();
  return {
    ...actual,
    fetchTemplatesList: serviceMocks.fetchTemplatesList,
    createTemplate: serviceMocks.createTemplate,
    updateTemplate: serviceMocks.updateTemplate,
    pauseTemplate: serviceMocks.pauseTemplate,
    resumeTemplate: serviceMocks.resumeTemplate,
    deleteTemplate: serviceMocks.deleteTemplate,
  };
});

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useRecurringTemplatesController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads recurring templates through the service layer", async () => {
    serviceMocks.fetchTemplatesList.mockResolvedValueOnce({
      data: [{ id: "tpl-1", title: "Weekly Raid", type: "raid", recurrence_rule: null }],
    });
    const showError = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const { result } = renderHook(
      () => useRecurringTemplatesController({ showError }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(serviceMocks.fetchTemplatesList).toHaveBeenCalledTimes(1);
    expect(result.current.templates).toEqual([
      expect.objectContaining({ id: "tpl-1", title: "Weekly Raid" }),
    ]);
    expect(showError).not.toHaveBeenCalled();
  });

  it("runs create and lifecycle actions outside the UI component", async () => {
    serviceMocks.fetchTemplatesList.mockResolvedValue({ data: [] });
    serviceMocks.createTemplate.mockResolvedValueOnce({ id: "tpl-2" });
    serviceMocks.updateTemplate.mockResolvedValueOnce({ id: "tpl-2" });
    serviceMocks.pauseTemplate.mockResolvedValueOnce(undefined);
    serviceMocks.resumeTemplate.mockResolvedValueOnce(undefined);
    serviceMocks.deleteTemplate.mockResolvedValueOnce(undefined);

    const showError = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useRecurringTemplatesController({ showError }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const payload = {
      type: "social" as const,
      title: "Weekly Raid",
      description: "Bring food",
      start_time: "19:00",
      timezone_offset_minutes: 480,
      recurrence_rule: {
        frequency: "weekly" as const,
        interval: 1,
        daysOfWeek: [2, 4],
      },
    };

    await act(async () => {
      await result.current.createRecurringTemplate(payload);
      await result.current.updateRecurringTemplate("tpl-2", payload);
      await result.current.pauseRecurringTemplate("tpl-2");
      await result.current.resumeRecurringTemplate("tpl-2");
      await result.current.deleteRecurringTemplate("tpl-2");
    });

    expect(serviceMocks.createTemplate).toHaveBeenCalledWith(payload, expect.any(Object));
    expect(serviceMocks.updateTemplate).toHaveBeenCalledWith("tpl-2", payload);
    expect(serviceMocks.pauseTemplate).toHaveBeenCalledWith("tpl-2", expect.any(Object));
    expect(serviceMocks.resumeTemplate).toHaveBeenCalledWith("tpl-2", expect.any(Object));
    expect(serviceMocks.deleteTemplate).toHaveBeenCalledWith("tpl-2", expect.any(Object));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.events.templates() });
    expect(notificationMocks.show).toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });
});
