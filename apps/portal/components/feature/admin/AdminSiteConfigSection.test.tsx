import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_OAUTH_SETTINGS,
  DEFAULT_SITE_STORAGE_POLICY,
  type AdminSiteConfigResponse,
} from "@guild/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminSiteConfigSection } from "./AdminSiteConfigSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      if (key === "siteConfig.summary.compact") return `features ${options?.enabled}/${options?.total}`;
      return key;
    },
  }),
}));

const siteConfig: AdminSiteConfigResponse = {
  site: {
    site_name: "Infini Guild",
    site_description: "A focused home for our guild.",
    site_logo_media_id: "logo1234567890abcdefg",
    default_site_logo_url: "/assets/default-site-logo.webp",
    features: DEFAULT_FEATURE_FLAGS,
    oauth: DEFAULT_SITE_OAUTH_SETTINGS,
    media_policy: DEFAULT_SITE_MEDIA_POLICY,
    storage_policy: DEFAULT_SITE_STORAGE_POLICY,
    absence_policy: {
      max_span_days: 366,
      max_entries_per_user: 20,
    },
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
  },
  revision_token: "site-config-v1",
  oauth_provider_status: {
    google: "missing_credentials",
    discord: "available",
    kook: "available",
    wechat: "unsupported",
  },
};

type AdminSiteConfigSectionProps = ComponentProps<typeof AdminSiteConfigSection>;

function renderSiteConfig(overrides: Partial<AdminSiteConfigSectionProps> = {}) {
  const props: AdminSiteConfigSectionProps = {
    data: siteConfig,
    loading: false,
    saving: false,
    logoUploading: false,
    onSaveSite: vi.fn().mockResolvedValue(siteConfig),
    onUploadLogo: vi.fn().mockResolvedValue(siteConfig),
    ...overrides,
  };
  const renderSection = (nextProps: AdminSiteConfigSectionProps) => (
    <AdminSiteConfigSection {...nextProps} />
  );
  const result = render(renderSection(props));

  return {
    ...result,
    rerenderSiteConfig(nextProps: Partial<AdminSiteConfigSectionProps>) {
      result.rerender(renderSection({ ...props, ...nextProps }));
    },
  };
}

/* 保存条是条件渲染的：干净时整块不在 DOM 里，所以每次都要重新查，
   不能把节点存下来跨断言复用——存下来的那个节点会在卸载后变成游离节点，
   对它断言 toBeDisabled 永远是「假绿」。 */
function querySaveButton() {
  return screen.queryByRole("button", { name: "siteConfig.action.saveAll" });
}

describe("AdminSiteConfigSection", () => {
  it("names the four configuration areas", () => {
    renderSiteConfig();

    for (const title of ["siteConfig.branding.title", "siteConfig.policy.features", "siteConfig.oauth.title", "siteConfig.policy.limits"]) {
      expect(screen.getByText(title)).toBeVisible();
    }
  });

  it("lists feature switches and OAuth provider cards separately", () => {
    renderSiteConfig();

    for (const feature of Object.keys(DEFAULT_FEATURE_FLAGS)) {
      expect(screen.getByRole("switch", { name: `siteConfig.feature.${feature}` })).toBeInTheDocument();
    }
    for (const provider of Object.keys(DEFAULT_SITE_OAUTH_SETTINGS)) {
      expect(screen.getByRole("switch", { name: `siteConfig.oauth.provider.${provider}` })).toBeInTheDocument();
    }
  });

  it("moves descriptive site config copy into info hover cards", () => {
    const { container } = renderSiteConfig();

    expect(screen.queryByText("siteConfig.policy.featuresDescription")).not.toBeInTheDocument();
    expect(screen.queryByText("siteConfig.field.siteDescriptionDescription")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".site-config-info-trigger").length).toBeGreaterThan(0);
  });

  it("keeps OAuth availability and configuration errors on each provider card", () => {
    const { container } = renderSiteConfig();

    const google = screen.getByRole("switch", { name: "siteConfig.oauth.provider.google" });
    const discord = screen.getByRole("switch", { name: "siteConfig.oauth.provider.discord" });
    const wechat = screen.getByRole("switch", { name: "siteConfig.oauth.provider.wechat" });

    expect(google).toHaveAttribute("aria-disabled", "true");
    expect(discord).not.toHaveAttribute("aria-disabled", "true");
    expect(wechat).toHaveAttribute("aria-disabled", "true");
    expect(container.querySelectorAll(".site-config-provider-card")).toHaveLength(4);
    expect(container.querySelectorAll(".site-config-provider-error")).toHaveLength(2);
    expect(screen.getByText("siteConfig.oauth.error.missing_credentials")).toBeInTheDocument();
    expect(screen.getByText("siteConfig.oauth.error.unsupported")).toBeInTheDocument();
  });

  it("groups the logo preview and upload as one branding field", () => {
    const { container } = renderSiteConfig();
    const logoField = container.querySelector(".site-config-logo-field");

    expect(logoField).toContainElement(container.querySelector(".site-config-logo-preview"));
    expect(logoField).toContainElement(screen.getByRole("button", {
      name: "siteConfig.action.uploadLogo",
    }));
    expect(container.querySelector(".site-config-brand-fields .site-config-logo-upload")).toBeNull();
  });

  it("saves only valid changes and replaces the local baseline with the canonical response", async () => {
    const user = userEvent.setup();
    const savedConfig: AdminSiteConfigResponse = {
      ...siteConfig,
      revision_token: "site-config-v2",
      site: {
        ...siteConfig.site,
        site_name: "Infini Guild Prime",
        updated_at: "2026-06-13T00:00:00.000Z",
      },
    };
    const onSaveSite = vi.fn().mockResolvedValue(savedConfig);
    renderSiteConfig({ onSaveSite });
    const siteNameInput = screen.getByRole("textbox", { name: "siteConfig.field.siteName" });

    expect(querySaveButton(), "没有改动时保存条不该出现").toBeNull();

    await user.clear(siteNameInput);
    await user.type(siteNameInput, "Infini Guild Prime");
    expect(querySaveButton()).toBeEnabled();

    await user.click(querySaveButton()!);
    expect(onSaveSite).toHaveBeenCalledTimes(1);
    expect(onSaveSite).toHaveBeenCalledWith(
      expect.objectContaining({
        site_name: "Infini Guild Prime",
        expected_revision_token: "site-config-v1",
      }),
    );

    await waitFor(() => {
      expect(siteNameInput).toHaveValue("Infini Guild Prime");
      expect(querySaveButton(), "保存响应成为新的版本基线后保存条应当收起").toBeNull();
    });
  });

  it("includes the compact public preview description in the shared save payload", async () => {
    const user = userEvent.setup();
    const onSaveSite = vi.fn().mockResolvedValue(siteConfig);
    renderSiteConfig({ onSaveSite });
    const description = screen.getByRole("textbox", { name: "siteConfig.field.siteDescription" });

    await user.clear(description);
    await user.type(description, "Our guild, in one place.");
    await user.click(querySaveButton()!);

    expect(onSaveSite).toHaveBeenCalledWith(expect.objectContaining({
      site_description: "Our guild, in one place.",
      expected_revision_token: "site-config-v1",
    }));
    expect(description).toHaveAttribute("maxlength", "300");
  });

  it("keeps the save bar visible but disabled for whitespace-only site names", async () => {
    const user = userEvent.setup();
    const onSaveSite = vi.fn().mockResolvedValue(siteConfig);
    renderSiteConfig({ onSaveSite });
    const siteNameInput = screen.getByRole("textbox", { name: "siteConfig.field.siteName" });

    await user.clear(siteNameInput);
    await user.type(siteNameInput, "   ");

    /* 「改了但存不了」和「没改」必须是两种看得出来的状态：
       前者保存条在、按钮禁用；后者保存条整块不在。 */
    expect(screen.getByText("siteConfig.unsavedChanges")).toBeInTheDocument();
    expect(querySaveButton()).toBeDisabled();
    await user.click(querySaveButton()!);
    expect(onSaveSite).not.toHaveBeenCalled();
  });

  it("tracks editable policy changes without treating logo upload as a pending save", async () => {
    const user = userEvent.setup();
    const onUploadLogo = vi.fn().mockResolvedValue({
      ...siteConfig,
      revision_token: "site-config-v2",
      site: { ...siteConfig.site, site_logo_media_id: "logo1234567890abcdefh" },
    });
    const { container } = renderSiteConfig({ onUploadLogo });
    const logoInput = container.querySelector<HTMLInputElement>('input[type="file"]');

    expect(logoInput).not.toBeNull();
    await user.upload(logoInput!, new File(["logo"], "logo.png", { type: "image/png" }));
    expect(onUploadLogo).toHaveBeenCalledWith(expect.any(File), "site-config-v1");
    expect(querySaveButton(), "上传 logo 走的是独立接口，不该被算成待保存改动").toBeNull();

    await user.click(
      screen.getByRole("switch", { name: "siteConfig.feature.announcements" }),
    );
    expect(querySaveButton()).toBeEnabled();
  });

  it("renders dedicated announcement attachment size and count limits", () => {
    renderSiteConfig();

    expect(screen.getByLabelText("siteConfig.fileSize.announcement_attachment")).toBeInTheDocument();
    expect(screen.getByLabelText("siteConfig.quota.announcement_attachments")).toBeInTheDocument();
  });

  it("only changes OAuth settings for providers whose runtime credentials are available", async () => {
    const user = userEvent.setup();
    const onSaveSite = vi.fn().mockResolvedValue(siteConfig);
    renderSiteConfig({ onSaveSite });

    await user.click(screen.getByRole("switch", { name: "siteConfig.oauth.provider.discord" }));
    await user.click(querySaveButton()!);

    expect(onSaveSite).toHaveBeenCalledWith(expect.objectContaining({
      oauth: expect.objectContaining({ discord: true, google: false, wechat: false }),
      expected_revision_token: "site-config-v1",
    }));
  });

  it("keeps an A/B stale draft and its original version after a 409 save failure", async () => {
    const user = userEvent.setup();
    const onSaveSite = vi.fn().mockRejectedValue({ status: 409 });
    renderSiteConfig({ onSaveSite });
    const siteNameInput = screen.getByRole("textbox", { name: "siteConfig.field.siteName" });

    await user.clear(siteNameInput);
    await user.type(siteNameInput, "A's draft");
    await user.click(querySaveButton()!);

    await waitFor(() => expect(onSaveSite).toHaveBeenCalledWith(expect.objectContaining({
      site_name: "A's draft",
      expected_revision_token: "site-config-v1",
    })));
    expect(siteNameInput).toHaveValue("A's draft");
    expect(querySaveButton()).toBeEnabled();
  });
});
