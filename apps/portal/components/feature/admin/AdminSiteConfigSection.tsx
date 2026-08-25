import {
  IMAGE_FILE_ACCEPT,
  LIMITS,
  MAX_CONFIGURABLE_ATTACHMENT_BYTES,
  MAX_CONFIGURABLE_AUDIO_BYTES,
  MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES,
  SITE_DESCRIPTION_MAX_LENGTH,
  type AdminSiteConfigResponse,
  type FeatureFlags,
  type UpdateSiteConfigPayload,
} from "@guild/shared";
import { AlertTriangleIcon, BookTextIcon, CloudIcon, GalleryThumbnailsIcon, InfoCircleIcon, SaveIcon, SettingsIcon, UploadIcon, WarehouseIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Switch } from "@portal/components/ui/switch";
import { Textarea } from "@portal/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { resolveMediaUrl } from "@portal/utils/media";

type AdminSiteConfigSectionProps = {
  data: AdminSiteConfigResponse | null;
  loading: boolean;
  saving: boolean;
  logoUploading: boolean;
  onSaveSite: (payload: UpdateSiteConfigPayload) => void;
  onUploadLogo: (file: File) => void;
};

type SiteConfigInfoProps = {
  title: string;
  description: string;
  icon: ReactNode;
};

type EditableSiteConfig = {
  site_name: string;
  site_description: string;
  features: FeatureFlags;
  oauth: AdminSiteConfigResponse["site"]["oauth"];
  media_policy: AdminSiteConfigResponse["site"]["media_policy"];
  storage_policy: AdminSiteConfigResponse["site"]["storage_policy"];
  absence_policy: AdminSiteConfigResponse["site"]["absence_policy"];
};

const FEATURE_KEYS: Array<keyof FeatureFlags> = ["announcements", "events", "guildWar", "gallery", "wiki", "tools", "storage"];
const OAUTH_KEYS: Array<keyof AdminSiteConfigResponse["site"]["oauth"]> = ["google", "discord", "kook", "wechat"];

const FEATURE_INFO_META: Record<keyof FeatureFlags, { icon: ReactNode }> = {
  announcements: { icon: <BookTextIcon size={16} /> },
  events: { icon: <SettingsIcon size={16} /> },
  guildWar: { icon: <SettingsIcon size={16} /> },
  gallery: { icon: <GalleryThumbnailsIcon size={16} /> },
  wiki: { icon: <BookTextIcon size={16} /> },
  tools: { icon: <SettingsIcon size={16} /> },
  storage: { icon: <WarehouseIcon size={16} /> },
};

function numberOr(value: string | number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatMb(bytes: number) {
  return Math.round(bytes / 1024 / 1024);
}

function copyEditableConfig(data: AdminSiteConfigResponse): EditableSiteConfig {
  const features = data.site.features;
  const mediaPolicy = data.site.media_policy;
  const storagePolicy = data.site.storage_policy;
  const absencePolicy = data.site.absence_policy;
  return {
    site_name: data.site.site_name,
    site_description: data.site.site_description,
    features: { ...features },
    oauth: { ...data.site.oauth },
    media_policy: {
      max_file_size_bytes: { ...mediaPolicy.max_file_size_bytes },
      quotas: { ...mediaPolicy.quotas },
    },
    storage_policy: { ...storagePolicy },
    absence_policy: { ...absencePolicy },
  };
}

function haveSameFields<T extends object>(left: T, right: T) {
  const leftKeys = Object.keys(left) as Array<keyof T>;
  return leftKeys.length === Object.keys(right).length
    && leftKeys.every((key) => left[key] === right[key]);
}

function areEditableConfigsEqual(left: EditableSiteConfig, right: EditableSiteConfig) {
  return left.site_name === right.site_name
    && left.site_description === right.site_description
    && haveSameFields(left.features, right.features)
    && haveSameFields(left.oauth, right.oauth)
    && haveSameFields(left.media_policy.max_file_size_bytes, right.media_policy.max_file_size_bytes)
    && haveSameFields(left.media_policy.quotas, right.media_policy.quotas)
    && haveSameFields(left.storage_policy, right.storage_policy)
    && haveSameFields(left.absence_policy, right.absence_policy);
}

function SiteConfigInfo({ title, description, icon }: SiteConfigInfoProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" className="site-config-info-trigger" aria-label={title} />}
      >
          <InfoCircleIcon size={15} />
      </TooltipTrigger>
      <TooltipContent className="site-config-info-card">
        <span className="site-config-info-card__icon" aria-hidden="true">{icon}</span>
        <span className="site-config-info-card__copy">
          <strong>{title}</strong>
          <span>{description}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function SiteConfigNumberField({
  id,
  label,
  value,
  min,
  max,
  suffix,
  onValueChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onValueChange: (value: number) => void;
}) {
  const suffixId = suffix ? `${id}-suffix` : undefined;

  return (
    <div className="site-config-number-field">
      <Label htmlFor={id}>{label}</Label>
      <div className="site-config-number-control">
        <Input
          id={id}
          className="site-config-number-input"
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          aria-describedby={suffixId}
          onChange={(event) => onValueChange(numberOr(event.currentTarget.valueAsNumber, value))}
        />
        {suffix ? <span id={suffixId} className="site-config-number-suffix">{suffix}</span> : null}
      </div>
    </div>
  );
}

export function AdminSiteConfigSection({
  data,
  loading,
  saving,
  logoUploading,
  onSaveSite,
  onUploadLogo,
}: AdminSiteConfigSectionProps) {
  const { t } = useTranslation("admin");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [siteName, setSiteName] = useState("");
  const [siteDescription, setSiteDescription] = useState("");
  const [siteLogoUrl, setSiteLogoUrl] = useState("");
  const [features, setFeatures] = useState<FeatureFlags | null>(null);
  const [oauth, setOauth] = useState<AdminSiteConfigResponse["site"]["oauth"] | null>(null);
  const [mediaPolicy, setMediaPolicy] = useState<AdminSiteConfigResponse["site"]["media_policy"] | null>(null);
  const [storagePolicy, setStoragePolicy] = useState<AdminSiteConfigResponse["site"]["storage_policy"] | null>(null);
  const [absencePolicy, setAbsencePolicy] = useState<AdminSiteConfigResponse["site"]["absence_policy"] | null>(null);
  const [baselineConfig, setBaselineConfig] = useState<EditableSiteConfig | null>(null);

  useEffect(() => {
    if (!data) return;
    const nextConfig = copyEditableConfig(data);
    setSiteName(nextConfig.site_name);
    setSiteDescription(nextConfig.site_description);
    setSiteLogoUrl(data.site.site_logo_media_id
      ? resolveMediaUrl(data.site.site_logo_media_id)
      : data.site.default_site_logo_url);
    setFeatures(nextConfig.features);
    setOauth(nextConfig.oauth);
    setMediaPolicy(nextConfig.media_policy);
    setStoragePolicy(nextConfig.storage_policy);
    setAbsencePolicy(nextConfig.absence_policy);
    setBaselineConfig(nextConfig);
  }, [data]);

  const currentConfig: EditableSiteConfig | null = features && oauth && mediaPolicy && storagePolicy && absencePolicy ? {
    site_name: siteName,
    site_description: siteDescription,
    features,
    oauth,
    media_policy: mediaPolicy,
    storage_policy: storagePolicy,
    absence_policy: absencePolicy,
  } : null;
  const hasPendingChanges = currentConfig !== null && baselineConfig !== null
    && !areEditableConfigsEqual(currentConfig, baselineConfig);
  const canSave = hasPendingChanges
    && siteName.trim().length > 0
    && siteDescription.trim().length > 0
    && siteDescription.trim().length <= SITE_DESCRIPTION_MAX_LENGTH
    && !saving;
  if (loading || !data || !currentConfig || !features || !oauth || !mediaPolicy || !storagePolicy || !absencePolicy) {
    return <p className="site-config-loading">{t("common:message.loading")}</p>;
  }
  const enabledFeatureCount = FEATURE_KEYS.filter((key) => features[key]).length;

  const handleSave = () => {
    if (!canSave) return;
    onSaveSite(currentConfig);
  };

  return (
    <div className="site-config">
      <section id="site-config-branding" className="admin-panel site-config-card">
        <div className="admin-panel__head">
          <div className="admin-panel__title">
            <span>{t("siteConfig.branding.title")}</span>
            <SiteConfigInfo
              title={t("siteConfig.branding.title")}
              description={t("siteConfig.branding.description")}
              icon={<GalleryThumbnailsIcon size={16} />}
            />
          </div>
        </div>

        <div className="admin-panel__body site-config-brand-block">
          <div className="site-config-logo-field">
            <div className="site-config-title-row">
              <strong>{t("siteConfig.field.siteLogo")}</strong>
              <SiteConfigInfo
                title={t("siteConfig.field.siteLogo")}
                description={t("siteConfig.field.siteLogoDescription")}
                icon={<UploadIcon size={16} />}
              />
            </div>
            <div className="site-config-logo-preview">
              {siteLogoUrl ? (
                <img src={siteLogoUrl} alt={t("siteConfig.field.siteLogo")} />
              ) : (
                <GalleryThumbnailsIcon size={28} />
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept={IMAGE_FILE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) onUploadLogo(file);
                event.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              className="site-config-logo-upload"
              variant="outline"
              size="sm"
              loading={logoUploading}
              onClick={() => logoInputRef.current?.click()}
            >
              <UploadIcon size={16} data-icon="inline-start" />
              {t("siteConfig.action.uploadLogo")}
            </Button>
          </div>
          <div className="site-config-brand-fields">
            <div className="site-config-text-field">
              <Label htmlFor="site-config-name">{t("siteConfig.field.siteName")}</Label>
              <Input id="site-config-name" value={siteName} onChange={(event) => setSiteName(event.currentTarget.value)} />
            </div>
            <div className="site-config-text-field">
              <Label htmlFor="site-config-description">{t("siteConfig.field.siteDescription")}</Label>
              <Textarea
                id="site-config-description"
                value={siteDescription}
                onChange={(event) => setSiteDescription(event.currentTarget.value)}
                maxLength={SITE_DESCRIPTION_MAX_LENGTH}
                rows={3}
              />
            </div>
          </div>
        </div>
      </section>

      <section id="site-config-features" className="admin-panel site-config-card">
        <div className="admin-panel__head">
          <div className="admin-panel__title">
            <span>{t("siteConfig.policy.features")}</span>
            <SiteConfigInfo
              title={t("siteConfig.policy.features")}
              description={t("siteConfig.policy.featuresDescription")}
              icon={<SettingsIcon size={16} />}
            />
          </div>
          <span className="site-config-count">{t("siteConfig.summary.compact", { enabled: enabledFeatureCount, total: FEATURE_KEYS.length })}</span>
        </div>

        <div className="admin-panel__body site-config-feature-list">
          {FEATURE_KEYS.map((key) => (
            <div key={key} className="site-config-feature-row">
              <span className="site-config-feature-label">
                <strong>{t(`siteConfig.feature.${key}`)}</strong>
                <SiteConfigInfo
                  title={t(`siteConfig.feature.${key}`)}
                  description={t(`siteConfig.featureDescription.${key}`)}
                  icon={FEATURE_INFO_META[key].icon}
                />
              </span>
              <Switch
                checked={features[key]}
                onCheckedChange={(checked) => {
                  setFeatures((current) => current ? ({ ...current, [key]: checked }) : current);
                }}
                aria-label={t(`siteConfig.feature.${key}`)}
              />
            </div>
          ))}
        </div>
      </section>

      <section id="site-config-oauth" className="admin-panel site-config-card">
        <div className="admin-panel__head">
          <div className="admin-panel__title">
            <span>{t("siteConfig.oauth.title")}</span>
            <SiteConfigInfo
              title={t("siteConfig.oauth.title")}
              description={t("siteConfig.oauth.description")}
              icon={<SettingsIcon size={16} />}
            />
          </div>
        </div>
        <div className="admin-panel__body site-config-provider-grid">
          {OAUTH_KEYS.map((provider) => {
            const status = data.oauth_provider_status[provider];
            const isAvailable = status === "available";
            const messageId = `site-config-oauth-${provider}-message`;

            return (
              <div
                key={provider}
                className={`site-config-provider-card site-config-provider-card--${status}`}
              >
                <div className="site-config-provider-main">
                  <div className="site-config-provider-copy">
                    <strong>{t(`siteConfig.oauth.provider.${provider}`)}</strong>
                    <span className={`site-config-provider-status site-config-provider-status--${status}`}>
                      {t(`siteConfig.oauth.status.${status}`)}
                    </span>
                  </div>
                  <Switch
                    checked={oauth[provider]}
                    disabled={!isAvailable}
                    onCheckedChange={(checked) => {
                      setOauth((current) => current ? ({ ...current, [provider]: checked }) : current);
                    }}
                    aria-label={t(`siteConfig.oauth.provider.${provider}`)}
                    aria-describedby={isAvailable ? undefined : messageId}
                  />
                </div>
                {!isAvailable ? (
                  <div id={messageId} className="site-config-provider-error" role="alert">
                    <AlertTriangleIcon size={15} aria-hidden="true" />
                    <span>{t(`siteConfig.oauth.error.${status}`)}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section id="site-config-limits" className="admin-panel site-config-card">
        <div className="admin-panel__head">
          <div className="admin-panel__title">
            <span>{t("siteConfig.policy.limits")}</span>
            <SiteConfigInfo
              title={t("siteConfig.policy.limits")}
              description={t("siteConfig.policy.limitsDescription")}
              icon={<CloudIcon size={16} />}
            />
          </div>
        </div>

        <div className="admin-panel__body site-config-limits-sections">
          <section className="site-config-subpanel">
            <strong>{t("siteConfig.policy.uploads")}</strong>
            <div className="site-config-number-grid">
              {Object.entries(mediaPolicy.max_file_size_bytes).map(([key, value]) => (
                <SiteConfigNumberField
                  key={key}
                  label={t(`siteConfig.fileSize.${key}`)}
                  value={formatMb(value)}
                  min={1}
                  max={formatMb(key === "profile_audio"
                    ? MAX_CONFIGURABLE_AUDIO_BYTES
                    : key === "announcement_attachment"
                      ? MAX_CONFIGURABLE_ATTACHMENT_BYTES
                      : MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES)}
                  id={`site-config-file-size-${key}`}
                  suffix="MB"
                  onValueChange={(next) => setMediaPolicy((current) => current ? ({
                    ...current,
                    max_file_size_bytes: {
                      ...current.max_file_size_bytes,
                      [key]: next * 1024 * 1024,
                    },
                  }) : current)}
                />
              ))}
            </div>
          </section>

          <section className="site-config-subpanel">
            <div className="site-config-subpanel-title">
              <WarehouseIcon size={18} />
              <strong>{t("siteConfig.policy.quotas")}</strong>
            </div>
            <div className="site-config-number-grid">
              {Object.entries(mediaPolicy.quotas).map(([key, value]) => (
                <SiteConfigNumberField
                  key={key}
                  label={t(`siteConfig.quota.${key}`)}
                  value={value}
                  min={1}
                  max={LIMITS.media.configurableQuotaMax}
                  id={`site-config-quota-${key}`}
                  onValueChange={(next) => setMediaPolicy((current) => current ? ({
                    ...current,
                    quotas: { ...current.quotas, [key]: next },
                  }) : current)}
                />
              ))}
              <SiteConfigNumberField
                label={t("siteConfig.storage.imagesPerItem")}
                value={storagePolicy.images_per_item}
                min={1}
                max={LIMITS.content.storageImagesPerItem.max}
                id="site-config-storage-images-per-item"
                onValueChange={(next) => setStoragePolicy((current) => current ? ({ ...current, images_per_item: next }) : current)}
              />
            </div>
          </section>

          <section className="site-config-subpanel">
            <strong>{t("siteConfig.policy.absence")}</strong>
            <div className="site-config-number-grid site-config-absence-grid">
              <SiteConfigNumberField
                label={t("siteConfig.absence.maxSpanDays")}
                value={absencePolicy.max_span_days}
                min={1}
                max={LIMITS.content.absenceSpanDays.max}
                id="site-config-absence-max-span-days"
                suffix={t("siteConfig.absence.days")}
                onValueChange={(next) => setAbsencePolicy((current) => current ? ({
                  ...current,
                  max_span_days: next,
                }) : current)}
              />
              <SiteConfigNumberField
                label={t("siteConfig.absence.maxEntries")}
                value={absencePolicy.max_entries_per_user}
                min={1}
                max={LIMITS.content.absencesPerUser.max}
                id="site-config-absence-max-entries"
                suffix={t("siteConfig.absence.entries")}
                onValueChange={(next) => setAbsencePolicy((current) => current ? ({
                  ...current,
                  max_entries_per_user: next,
                }) : current)}
              />
            </div>
          </section>
        </div>
      </section>

      {/* The save bar remains visible for invalid dirty state, but not for a clean form. */}
      {hasPendingChanges ? (
        <div className="site-config-savebar" role="status">
          <strong>{t("siteConfig.unsavedChanges")}</strong>
          <Button onClick={handleSave} loading={saving} disabled={!canSave}>
            <SaveIcon size={16} data-icon="inline-start" />
            {t("siteConfig.action.saveAll")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
