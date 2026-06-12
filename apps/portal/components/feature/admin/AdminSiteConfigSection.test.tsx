// @vitest-environment jsdom
import { DEFAULT_FEATURE_FLAGS, DEFAULT_SITE_MEDIA_POLICY, DEFAULT_SITE_STORAGE_POLICY, type AdminSiteConfigResponse } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminSiteConfigSection } from "./AdminSiteConfigSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      if (key === "siteConfig.summary.compact") return `features ${options?.enabled}/${options?.total}, onboarding ${options?.count}`;
      return key;
    },
  }),
}));

vi.mock("@portal/components/shared/TipTapEditor", () => ({
  TipTapEditor: () => <div data-testid="site-config-rules-editor" />,
}));

const siteConfig: AdminSiteConfigResponse = {
  site: {
    site_name: "Infini Guild",
    site_logo_url: "/logo.png",
    features: DEFAULT_FEATURE_FLAGS,
    media_policy: DEFAULT_SITE_MEDIA_POLICY,
    pagination_policy: {
      admin: 50,
      announcements: 50,
      events: 100,
      gallery: 24,
      guild_war: 20,
      users: 500,
      wiki: 50,
    },
    storage_policy: DEFAULT_SITE_STORAGE_POLICY,
    absence_policy: {
      max_span_days: 366,
      max_entries_per_user: 20,
    },
    analytics_settings: {
      reference_duration_minutes: 30,
      modifier_weights: {},
    },
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
  },
  onboarding: {
    title: "Member onboarding",
    body_json: "<p>Rules</p>",
    checklist: [
      { id: "read-rules", label: "Read rules", description: "Review policy", required: true },
      { id: "fill-profile", label: "Fill profile", description: null, required: true },
    ],
    enabled: false,
    require_ack: true,
    published_at: null,
    updated_by: null,
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
  },
};

function renderSiteConfig(onSaveSite = vi.fn()) {
  return render(
    <MantineProvider>
      <AdminSiteConfigSection
        data={siteConfig}
        loading={false}
        saving={false}
        logoUploading={false}
        onSaveSite={onSaveSite}
        onUploadLogo={vi.fn()}
      />
    </MantineProvider>,
  );
}

describe("AdminSiteConfigSection layout", () => {
  it("renders a calmer two-column workspace with grouped content sections", () => {
    const { container } = renderSiteConfig();

    expect(container.querySelector(".site-config-workspace")).toBeInTheDocument();
    expect(container.querySelector(".site-config-rail")).toBeInTheDocument();
    expect(container.querySelector(".site-config-content")).toBeInTheDocument();
    expect(container.querySelector(".site-config-overview-grid")).toBeInTheDocument();
    expect(container.querySelector(".site-config-checklist-list")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "siteConfig.action.saveAll" })).toBeInTheDocument();
  });

  it("renders onboarding enable control and sends enabled state on save", () => {
    const onSaveSite = vi.fn();
    renderSiteConfig(onSaveSite);

    const onboardingSwitch = screen.getByRole("switch", { name: "siteConfig.field.onboardingEnabled" });
    expect(onboardingSwitch).not.toBeChecked();

    fireEvent.click(onboardingSwitch);
    fireEvent.click(screen.getByRole("button", { name: "siteConfig.action.saveAll" }));

    expect(onSaveSite).toHaveBeenCalledWith(expect.objectContaining({
      onboarding: expect.objectContaining({
        enabled: true,
      }),
    }));
  });

  it("moves descriptive site config copy into info hover cards", () => {
    const { container } = renderSiteConfig();

    expect(screen.queryByText("siteConfig.onboarding.description")).not.toBeInTheDocument();
    expect(screen.queryByText("siteConfig.field.onboardingEnabledDescription")).not.toBeInTheDocument();
    expect(screen.queryByText("siteConfig.policy.featuresDescription")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".site-config-info-trigger").length).toBeGreaterThan(0);
  });
});
