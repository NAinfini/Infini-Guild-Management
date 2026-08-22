import {
  IMAGE_FILE_ACCEPT,
  LIMITS,
  MAX_CONFIGURABLE_AUDIO_BYTES,
  MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES,
  SITE_DESCRIPTION_MAX_LENGTH,
  type AdminSiteConfigResponse,
  type FeatureFlags,
  type UpdateSiteConfigPayload,
} from "@guild/shared";
import { Badge, Button, FileButton, Group, HoverCard, NumberInput, SimpleGrid, Stack, Switch, Text, Textarea, TextInput, ThemeIcon, UnstyledButton } from "@mantine/core";
import { BookTextIcon, CloudIcon, GalleryThumbnailsIcon, InfoCircleIcon, SaveIcon, SettingsIcon, UploadIcon, WarehouseIcon } from "@portal/components/icons";
import { useEffect, useState, type ReactNode } from "react";
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
  color?: string;
  badge?: string;
};

type EditableSiteConfig = {
  site_name: string;
  site_description: string;
  features: FeatureFlags;
  media_policy: AdminSiteConfigResponse["site"]["media_policy"];
  storage_policy: AdminSiteConfigResponse["site"]["storage_policy"];
  absence_policy: AdminSiteConfigResponse["site"]["absence_policy"];
};

const FEATURE_KEYS: Array<keyof FeatureFlags> = ["announcements", "events", "guildWar", "gallery", "wiki", "tools", "storage"];

const FEATURE_INFO_META: Record<keyof FeatureFlags, { icon: ReactNode; color: string }> = {
  announcements: { icon: <BookTextIcon size={16} />, color: "blue" },
  events: { icon: <SettingsIcon size={16} />, color: "grape" },
  guildWar: { icon: <SettingsIcon size={16} />, color: "orange" },
  gallery: { icon: <GalleryThumbnailsIcon size={16} />, color: "teal" },
  wiki: { icon: <BookTextIcon size={16} />, color: "violet" },
  tools: { icon: <SettingsIcon size={16} />, color: "gray" },
  storage: { icon: <WarehouseIcon size={16} />, color: "teal" },
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
    && haveSameFields(left.media_policy.max_file_size_bytes, right.media_policy.max_file_size_bytes)
    && haveSameFields(left.media_policy.quotas, right.media_policy.quotas)
    && haveSameFields(left.storage_policy, right.storage_policy)
    && haveSameFields(left.absence_policy, right.absence_policy);
}

function SiteConfigInfo({ title, description, icon, color = "gray", badge }: SiteConfigInfoProps) {
  return (
    <HoverCard width={320} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
      <HoverCard.Target>
        <UnstyledButton className="site-config-info-trigger" aria-label={title}>
          <InfoCircleIcon size={15} />
        </UnstyledButton>
      </HoverCard.Target>
      <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color={color} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
            {icon}
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Group gap={6} mb={4}>
              <Text size="sm" fw={700} lh={1.3}>{title}</Text>
              {badge ? <Badge size="xs" color={color} variant="light">{badge}</Badge> : null}
            </Group>
            <Text size="xs" c="dimmed" lh={1.5}>{description}</Text>
          </div>
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
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
  const [siteName, setSiteName] = useState("");
  const [siteDescription, setSiteDescription] = useState("");
  const [siteLogoUrl, setSiteLogoUrl] = useState("");
  const [features, setFeatures] = useState<FeatureFlags | null>(null);
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
    setMediaPolicy(nextConfig.media_policy);
    setStoragePolicy(nextConfig.storage_policy);
    setAbsencePolicy(nextConfig.absence_policy);
    setBaselineConfig(nextConfig);
  }, [data]);

  const currentConfig: EditableSiteConfig | null = features && mediaPolicy && storagePolicy && absencePolicy ? {
    site_name: siteName,
    site_description: siteDescription,
    features,
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
  if (loading || !currentConfig || !features || !mediaPolicy || !storagePolicy || !absencePolicy) {
    return <Text c="dimmed">{t("common:loading")}</Text>;
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
            <Text>{t("siteConfig.branding.title")}</Text>
            <SiteConfigInfo
              title={t("siteConfig.branding.title")}
              description={t("siteConfig.branding.description")}
              icon={<GalleryThumbnailsIcon size={16} />}
              color="gray"
            />
          </div>
        </div>

        <div className="admin-panel__body site-config-brand-block">
          <div className="site-config-logo-field">
            <div className="site-config-title-row">
              <Text size="sm" fw={700}>{t("siteConfig.field.siteLogo")}</Text>
              <SiteConfigInfo
                title={t("siteConfig.field.siteLogo")}
                description={t("siteConfig.field.siteLogoDescription")}
                icon={<UploadIcon size={16} />}
                color="gray"
              />
            </div>
            <div className="site-config-logo-preview">
              {siteLogoUrl ? (
                <img src={siteLogoUrl} alt={t("siteConfig.field.siteLogo")} />
              ) : (
                <GalleryThumbnailsIcon size={28} />
              )}
            </div>
            <FileButton onChange={(file) => { if (file) onUploadLogo(file); }} accept={IMAGE_FILE_ACCEPT}>
              {(buttonProps) => (
                <Button fullWidth size="sm" variant="default" loading={logoUploading} leftSection={<UploadIcon size={16} />} {...buttonProps}>
                  {t("siteConfig.action.uploadLogo")}
                </Button>
              )}
            </FileButton>
          </div>
          <div className="site-config-brand-fields">
            <TextInput size="sm" label={t("siteConfig.field.siteName")} value={siteName} onChange={(event) => setSiteName(event.currentTarget.value)} />
            <Textarea
              size="sm"
              label={t("siteConfig.field.siteDescription")}
              value={siteDescription}
              onChange={(event) => setSiteDescription(event.currentTarget.value)}
              maxLength={SITE_DESCRIPTION_MAX_LENGTH}
              autosize
              minRows={3}
              maxRows={4}
            />
          </div>
        </div>
      </section>

      <section id="site-config-features" className="admin-panel site-config-card">
        <div className="admin-panel__head">
          <div className="admin-panel__title">
            <Text>{t("siteConfig.policy.features")}</Text>
            <SiteConfigInfo
              title={t("siteConfig.policy.features")}
              description={t("siteConfig.policy.featuresDescription")}
              icon={<SettingsIcon size={16} />}
              color="gray"
            />
          </div>
          <Text size="xs" fw={700} className="site-config-count">{t("siteConfig.summary.compact", { enabled: enabledFeatureCount, total: FEATURE_KEYS.length })}</Text>
        </div>

        <div className="admin-panel__body site-config-feature-list">
          {FEATURE_KEYS.map((key) => (
            <div key={key} className="site-config-feature-row">
              <span className="site-config-feature-label">
                <Text size="sm" fw={700}>{t(`siteConfig.feature.${key}`)}</Text>
                <SiteConfigInfo
                  title={t(`siteConfig.feature.${key}`)}
                  description={t(`siteConfig.featureDescription.${key}`)}
                  icon={FEATURE_INFO_META[key].icon}
                  color={FEATURE_INFO_META[key].color}
                />
              </span>
              <Switch
                checked={features[key]}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setFeatures((current) => current ? ({ ...current, [key]: checked }) : current);
                }}
                aria-label={t(`siteConfig.feature.${key}`)}
              />
            </div>
          ))}
        </div>
      </section>

      <section id="site-config-limits" className="admin-panel site-config-card">
        <div className="admin-panel__head">
          <div className="admin-panel__title">
            <Text>{t("siteConfig.policy.limits")}</Text>
            <SiteConfigInfo
              title={t("siteConfig.policy.limits")}
              description={t("siteConfig.policy.limitsDescription")}
              icon={<CloudIcon size={16} />}
              color="gray"
            />
          </div>
        </div>

        <div className="admin-panel__body site-config-limits-sections">
          <Stack gap={12} className="site-config-subpanel">
            <Text size="sm" fw={700}>{t("siteConfig.policy.uploads")}</Text>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
              {Object.entries(mediaPolicy.max_file_size_bytes).map(([key, value]) => (
                <NumberInput
                  key={key}
                  size="sm"
                  label={t(`siteConfig.fileSize.${key}`)}
                  value={formatMb(value)}
                  min={1}
                  max={formatMb(key === "profile_audio"
                    ? MAX_CONFIGURABLE_AUDIO_BYTES
                    : MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES)}
                  suffix=" MB"
                  hideControls
                  onChange={(next) => setMediaPolicy((current) => current ? ({
                    ...current,
                    max_file_size_bytes: {
                      ...current.max_file_size_bytes,
                      [key]: numberOr(next, formatMb(value)) * 1024 * 1024,
                    },
                  }) : current)}
                />
              ))}
            </SimpleGrid>
          </Stack>

          <Stack gap={12} className="site-config-subpanel">
            <Group gap={8}>
              <WarehouseIcon size={18} />
              <Text size="sm" fw={700}>{t("siteConfig.policy.quotas")}</Text>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
              {Object.entries(mediaPolicy.quotas).map(([key, value]) => (
                <NumberInput
                  key={key}
                  size="sm"
                  label={t(`siteConfig.quota.${key}`)}
                  value={value}
                  min={1}
                  max={LIMITS.media.configurableQuotaMax}
                  hideControls
                  onChange={(next) => setMediaPolicy((current) => current ? ({
                    ...current,
                    quotas: { ...current.quotas, [key]: numberOr(next, value) },
                  }) : current)}
                />
              ))}
              <NumberInput
                size="sm"
                hideControls
                label={t("siteConfig.storage.imagesPerItem")}
                value={storagePolicy.images_per_item}
                min={1}
                max={LIMITS.content.storageImagesPerItem.max}
                onChange={(next) => setStoragePolicy((current) => current ? ({ ...current, images_per_item: numberOr(next, current.images_per_item) }) : current)}
              />
            </SimpleGrid>
          </Stack>
        </div>
      </section>

      {/* The save bar remains visible for invalid dirty state, but not for a clean form. */}
      {hasPendingChanges ? (
        <div className="site-config-savebar" role="status">
          <Text size="sm" fw={700}>{t("siteConfig.unsavedChanges")}</Text>
          <Button onClick={handleSave} loading={saving} disabled={!canSave} leftSection={<SaveIcon size={16} />}>
            {t("siteConfig.action.saveAll")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
