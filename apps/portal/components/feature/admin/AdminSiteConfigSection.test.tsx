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
    onSaveSite: vi.fn(),
    onUploadLogo: vi.fn(),
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

describe("AdminSiteConfigSection layout", () => {
  it("renders the four configuration regions without a second-level nav", () => {
    const { container } = renderSiteConfig();

    expect(container.querySelector(".site-config")).toBeInTheDocument();
    expect(container.querySelectorAll(".site-config > .site-config-card")).toHaveLength(4);
    expect(container.querySelector(".site-config-rail")).not.toBeInTheDocument();
    expect(container.querySelectorAll('a[href^="#site-config-"]')).toHaveLength(0);
    expect(container.querySelector("#site-config-branding")).toHaveClass("site-config-card");
    expect(container.querySelector("#site-config-features")).toHaveClass("site-config-card");
    expect(container.querySelector("#site-config-oauth")).toHaveClass("site-config-card");
    expect(container.querySelector("#site-config-limits")).toHaveClass("site-config-card");
  });

  it("lists feature switches and OAuth provider cards separately", () => {
    const { container } = renderSiteConfig();

    const featureCount = Object.keys(DEFAULT_FEATURE_FLAGS).length;
    expect(container.querySelectorAll("#site-config-features .site-config-feature-row")).toHaveLength(featureCount);
    expect(container.querySelectorAll('#site-config-features .site-config-feature-row [role="switch"]')).toHaveLength(featureCount);
    expect(container.querySelectorAll("#site-config-oauth .site-config-provider-card")).toHaveLength(
      Object.keys(DEFAULT_SITE_OAUTH_SETTINGS).length,
    );
    expect(container.querySelectorAll('#site-config-oauth .site-config-provider-card [role="switch"]')).toHaveLength(
      Object.keys(DEFAULT_SITE_OAUTH_SETTINGS).length,
    );
    expect(container.querySelector(".site-config-feature-grid")).not.toBeInTheDocument();
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

  it("saves only valid changes and hides the save bar when the parent supplies the saved data", async () => {
    const user = userEvent.setup();
    const onSaveSite = vi.fn();
    const { rerenderSiteConfig } = renderSiteConfig({ onSaveSite });
    const siteNameInput = screen.getByRole("textbox", { name: "siteConfig.field.siteName" });

    expect(querySaveButton(), "没有改动时保存条不该出现").toBeNull();

    await user.clear(siteNameInput);
    await user.type(siteNameInput, "Infini Guild Prime");
    expect(querySaveButton()).toBeEnabled();

    await user.click(querySaveButton()!);
    expect(onSaveSite).toHaveBeenCalledTimes(1);
    expect(onSaveSite).toHaveBeenCalledWith(
      expect.objectContaining({ site_name: "Infini Guild Prime" }),
    );

    /* 保存中：改动还没回来，保存条仍在，但按钮必须锁住，避免重复提交。 */
    rerenderSiteConfig({ saving: true });
    expect(querySaveButton()).toBeDisabled();
    expect(querySaveButton()).toHaveAttribute("data-loading", "true");
    await user.click(querySaveButton()!);
    expect(onSaveSite).toHaveBeenCalledTimes(1);

    rerenderSiteConfig({
      data: {
        ...siteConfig,
        site: {
          ...siteConfig.site,
          site_name: "Infini Guild Prime",
          updated_at: "2026-06-13T00:00:00.000Z",
        },
      },
      saving: false,
    });

    await waitFor(() => {
      expect(siteNameInput).toHaveValue("Infini Guild Prime");
      expect(querySaveButton(), "父层回填保存结果后保存条应当收起").toBeNull();
    });
  });

  it("includes the compact public preview description in the shared save payload", async () => {
    const user = userEvent.setup();
    const onSaveSite = vi.fn();
    renderSiteConfig({ onSaveSite });
    const description = screen.getByRole("textbox", { name: "siteConfig.field.siteDescription" });

    await user.clear(description);
    await user.type(description, "Our guild, in one place.");
    await user.click(querySaveButton()!);

    expect(onSaveSite).toHaveBeenCalledWith(expect.objectContaining({
      site_description: "Our guild, in one place.",
    }));
    expect(description).toHaveAttribute("maxlength", "300");
  });

  it("keeps the save bar visible but disabled for whitespace-only site names", async () => {
    const user = userEvent.setup();
    const onSaveSite = vi.fn();
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
    const onUploadLogo = vi.fn();
    const { container } = renderSiteConfig({ onUploadLogo });
    const logoInput = container.querySelector<HTMLInputElement>('input[type="file"]');

    expect(logoInput).not.toBeNull();
    await user.upload(logoInput!, new File(["logo"], "logo.png", { type: "image/png" }));
    expect(onUploadLogo).toHaveBeenCalledTimes(1);
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
    const onSaveSite = vi.fn();
    renderSiteConfig({ onSaveSite });

    await user.click(screen.getByRole("switch", { name: "siteConfig.oauth.provider.discord" }));
    await user.click(querySaveButton()!);

    expect(onSaveSite).toHaveBeenCalledWith(expect.objectContaining({
      oauth: expect.objectContaining({ discord: true, google: false, wechat: false }),
    }));
  });
});
