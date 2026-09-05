import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/query-keys";
import { SettingsPage } from "./SettingsPage";

const mocks = vi.hoisted(() => ({
  locale: "en" as "en" | "zh",
  theme: "light" as "light" | "dark",
  themeMode: "system" as "system" | "light" | "dark",
  motionPreference: "system" as "system" | "reduce",
  accent: "teal" as "teal" | "indigo" | "violet" | "orange",
  setLocale: vi.fn(),
  setTheme: vi.fn(),
  setAccent: vi.fn(),
  setMotionPreference: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));
const externalViewState = vi.hoisted(() => ({
  enabled: false,
}));
const notificationServiceMocks = vi.hoisted(() => ({
  fetchNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("../../stores/preferences", () => ({
  usePreferencesStore: () => ({
    locale: mocks.locale,
    setLocale: mocks.setLocale,
    themeMode: mocks.themeMode,
    motionPreference: mocks.motionPreference,
    setMotionPreference: mocks.setMotionPreference,
  }),
}));

vi.mock("../../providers/ThemeProvider", () => ({
  useTheme: () => ({
    theme: mocks.theme,
    setTheme: mocks.setTheme,
    accent: mocks.accent,
    setAccent: mocks.setAccent,
  }),
}));

vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

vi.mock("../../services/NotificationService", () => ({
  fetchNotificationPreferences: notificationServiceMocks.fetchNotificationPreferences,
  updateNotificationPreferences: notificationServiceMocks.updateNotificationPreferences,
}));

vi.mock("../../hooks/useAppError", () => ({
  useAppError: () => ({ showError: vi.fn() }),
}));

vi.mock("../../hooks/useExternalView", () => ({
  useExternalView: () => externalViewState.enabled,
}));

function renderSettingsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    ...render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
    ),
  };
}

describe("SettingsPage", () => {
  beforeEach(() => {
    mocks.locale = "en";
    mocks.theme = "light";
    mocks.themeMode = "system";
    mocks.motionPreference = "system";
    mocks.accent = "teal";
    mocks.setLocale.mockReset();
    mocks.setTheme.mockReset();
    mocks.setAccent.mockReset();
    mocks.setMotionPreference.mockReset();
    authState.user = null;
    externalViewState.enabled = false;
    notificationServiceMocks.fetchNotificationPreferences.mockReset();
    notificationServiceMocks.updateNotificationPreferences.mockReset();
    notificationServiceMocks.fetchNotificationPreferences.mockResolvedValue({
      member_joined: true,
      announcement_published: true,
      event_created: true,
      wiki_article_created: true,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    notificationServiceMocks.updateNotificationPreferences.mockResolvedValue({
      member_joined: false,
      announcement_published: true,
      event_created: true,
      wiki_article_created: true,
      updated_at: "2026-01-01T00:00:01.000Z",
    });
  });

  it("uses native radio semantics and immediately updates preferences", async () => {
    const user = userEvent.setup();
    renderSettingsPage();

    expect(screen.queryByRole("heading", { name: "settings.title" })).not.toBeInTheDocument();
    expect(screen.queryByText("settings.description")).not.toBeInTheDocument();

    const appearance = screen.getByRole("group", { name: "section.appearance" });
    const preferences = screen.getByRole("group", { name: "section.preferences" });

    expect(within(appearance).getByRole("radio", { name: /theme\.system/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(preferences).getByRole("radio", { name: /locale\.en/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(within(appearance).getByRole("radio", { name: /theme\.dark/ }));
    await user.click(within(appearance).getByRole("radio", { name: /accent\.indigo/ }));
    await user.click(within(preferences).getByRole("radio", { name: /locale\.zh/ }));

    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.setAccent).toHaveBeenCalledWith("indigo");
    expect(mocks.setLocale).toHaveBeenCalledWith("zh");
  });

  it("keeps the system preference selected when the resolved theme is dark", () => {
    mocks.theme = "dark";
    renderSettingsPage();

    expect(screen.getByRole("radio", { name: /theme\.system/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /theme\.dark/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /theme\.light/ })).toHaveAttribute("aria-checked", "false");
  });

  it("lets an explicit theme return to the system preference", async () => {
    const user = userEvent.setup();
    mocks.themeMode = "light";
    renderSettingsPage();

    expect(screen.getByRole("radio", { name: /theme\.light/ })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: /theme\.system/ }));

    expect(mocks.setTheme).toHaveBeenCalledWith("system");
  });

  it.each([
    ["system", "reduce"],
    ["reduce", "system"],
  ] as const)("changes motion preference from %s to %s locally", async (initial, next) => {
    const user = userEvent.setup();
    mocks.motionPreference = initial;
    renderSettingsPage();

    const appearance = screen.getByRole("group", { name: "section.appearance" });
    const toggle = within(appearance).getByRole("switch", { name: "motion.reduce" });
    expect(toggle).toHaveAttribute("aria-checked", String(initial === "reduce"));
    expect(toggle).toHaveAccessibleDescription("motion.reduce.desc");
    await user.click(toggle);

    expect(mocks.setMotionPreference).toHaveBeenCalledWith(next);
    expect(notificationServiceMocks.fetchNotificationPreferences).not.toHaveBeenCalled();
    expect(notificationServiceMocks.updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("supports arrow-key selection within each radio group", async () => {
    const user = userEvent.setup();
    renderSettingsPage();

    const light = screen.getByRole("radio", { name: /theme\.light/ });
    light.focus();
    await user.keyboard("{ArrowRight}");

    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });

  it("loads server-synced notification preferences and saves a toggle", async () => {
    const user = userEvent.setup();
    authState.user = { id: "user-1" };
    renderSettingsPage();

    const memberJoined = await screen.findByRole("switch", {
      name: /notification\.member_joined\.label/,
    });
    const preferences = screen.getByRole("group", { name: "section.preferences" });
    expect(within(preferences).getAllByRole("switch")).toHaveLength(4);
    expect(within(screen.getByRole("group", { name: "section.appearance" })).queryByText("field.notifications"))
      .not.toBeInTheDocument();
    expect(notificationServiceMocks.fetchNotificationPreferences).toHaveBeenCalledOnce();
    expect(memberJoined).toHaveAttribute("aria-checked", "true");

    await user.click(memberJoined);
    await waitFor(() =>
      expect(notificationServiceMocks.updateNotificationPreferences).toHaveBeenCalledWith({
        member_joined: false,
      }),
    );
    await waitFor(() => expect(memberJoined).toHaveAttribute("aria-checked", "false"));
  });

  it("keeps cached notification preferences visible after a failed refresh", async () => {
    authState.user = { id: "user-1" };
    notificationServiceMocks.fetchNotificationPreferences
      .mockReset()
      .mockResolvedValueOnce({
        member_joined: true,
        announcement_published: true,
        event_created: true,
        wiki_article_created: true,
        updated_at: "2026-01-01T00:00:00.000Z",
      })
      .mockRejectedValueOnce(new Error("refresh unavailable"));
    const { queryClient } = renderSettingsPage();

    expect(await screen.findByRole("switch", { name: /notification\.member_joined\.label/ })).toBeInTheDocument();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.preferences("user-1") });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("common:loadError");
    expect(screen.getByRole("switch", { name: /notification\.member_joined\.label/ })).toBeInTheDocument();
  });

  it("does not load or expose private notification preferences in external preview", () => {
    authState.user = { id: "user-1" };
    externalViewState.enabled = true;

    renderSettingsPage();

    expect(notificationServiceMocks.fetchNotificationPreferences).not.toHaveBeenCalled();
    expect(screen.queryByText("field.notifications")).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: "motion.reduce" })).toBeInTheDocument();
  });

});
