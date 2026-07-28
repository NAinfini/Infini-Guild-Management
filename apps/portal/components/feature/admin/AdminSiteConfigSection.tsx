import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
  LIMITS,
  MAX_CONFIGURABLE_MEDIA_FILE_BYTES,
  type AdminSiteConfigResponse,
  type FeatureFlags,
  type UpdateSiteConfigPayload,
} from "@guild/shared";
import { Badge, Button, FileButton, Group, HoverCard, NumberInput, SimpleGrid, Stack, Switch, Text, TextInput, ThemeIcon, UnstyledButton } from "@mantine/core";
import { BookTextIcon, CloudIcon, GalleryThumbnailsIcon, InfoCircleIcon, SaveIcon, SettingsIcon, UploadIcon, WarehouseIcon } from "@portal/components/icons";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

type AdminSiteConfigSectionProps = {
  data: AdminSiteConfigResponse | null;
  loading: boolean;
  saving: boolean;
  logoUploading: boolean;
  onSaveSite: (payload: UpdateSiteConfigPayload) => void;
  onUploadLogo: (file: File) => void;
};

type SiteConfigNavItem = {
  id: string;
  title: string;
  icon: ReactNode;
};

type SiteConfigInfoProps = {
  title: string;
  description: string;
  icon: ReactNode;
  color?: string;
  badge?: string;
};

const FEATURE_KEYS: Array<keyof FeatureFlags> = ["announcements", "events", "guildWar", "gallery", "wiki", "tools", "equipmentCalc", "storage"];

const FEATURE_INFO_META: Record<keyof FeatureFlags, { icon: ReactNode; color: string }> = {
  announcements: { icon: <BookTextIcon size={16} />, color: "blue" },
  events: { icon: <SettingsIcon size={16} />, color: "grape" },
  guildWar: { icon: <SettingsIcon size={16} />, color: "orange" },
  gallery: { icon: <GalleryThumbnailsIcon size={16} />, color: "teal" },
  wiki: { icon: <BookTextIcon size={16} />, color: "violet" },
  tools: { icon: <SettingsIcon size={16} />, color: "gray" },
  storage: { icon: <WarehouseIcon size={16} />, color: "teal" },
  equipmentCalc: { icon: <SettingsIcon size={16} />, color: "gray" },
};

function numberOr(value: string | number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatMb(bytes: number) {
  return Math.round(bytes / 1024 / 1024);
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
  const [siteLogoUrl, setSiteLogoUrl] = useState("");
  const [features, setFeatures] = useState<FeatureFlags>({ ...DEFAULT_FEATURE_FLAGS });
  const [mediaPolicy, setMediaPolicy] = useState<AdminSiteConfigResponse["site"]["media_policy"]>(DEFAULT_SITE_MEDIA_POLICY);
  const [storagePolicy, setStoragePolicy] = useState<AdminSiteConfigResponse["site"]["storage_policy"]>(DEFAULT_SITE_STORAGE_POLICY);
  const [absencePolicy, setAbsencePolicy] = useState<AdminSiteConfigResponse["site"]["absence_policy"]>(DEFAULT_SITE_ABSENCE_POLICY);

  useEffect(() => {
    if (!data) return;
    setSiteName(data.site.site_name);
    setSiteLogoUrl(data.site.site_logo_url);
    setFeatures(data.site.features ?? DEFAULT_FEATURE_FLAGS);
    setMediaPolicy(data.site.media_policy ?? DEFAULT_SITE_MEDIA_POLICY);
    setStoragePolicy(data.site.storage_policy ?? DEFAULT_SITE_STORAGE_POLICY);
    setAbsencePolicy(data.site.absence_policy ?? DEFAULT_SITE_ABSENCE_POLICY);
  }, [data]);

  const enabledFeatureCount = FEATURE_KEYS.filter((key) => features[key]).length;

  const navItems: SiteConfigNavItem[] = [
    {
      id: "branding",
      title: t("siteConfig.branding.title"),
      icon: <GalleryThumbnailsIcon size={18} />,
    },
    {
      id: "features",
      title: t("siteConfig.policy.features"),
      icon: <SettingsIcon size={18} />,
    },
    {
      id: "limits",
      title: t("siteConfig.policy.limits"),
      icon: <CloudIcon size={18} />,
    },
  ];

  if (loading) {
    return <Text c="dimmed">{t("common:loading")}</Text>;
  }

  const handleSave = () => {
    onSaveSite({
      site_name: siteName,
      features,
      media_policy: mediaPolicy,
      storage_policy: storagePolicy,
      absence_policy: absencePolicy,
    });
  };

  return (
    <div className="site-config-workspace">
      <aside className="site-config-rail" aria-label={t("siteConfig.navLabel")}>
        <div className="site-config-rail__header">
          <Text size="xs" c="dimmed">{t("siteConfig.navEyebrow")}</Text>
          <Text size="lg" fw={800}>{t("tab.siteConfig")}</Text>
          <Text size="xs" c="dimmed">{t("siteConfig.summary.compact", { enabled: enabledFeatureCount, total: FEATURE_KEYS.length })}</Text>
        </div>

        <nav className="site-config-rail__nav">
          {navItems.map((item) => (
            <a key={item.id} href={`#site-config-${item.id}`} className="site-config-rail__item">
              <span className="site-config-rail__icon">{item.icon}</span>
              <Text size="sm" fw={700}>{item.title}</Text>
            </a>
          ))}
        </nav>

        <Button className="site-config-save-button" onClick={handleSave} loading={saving} leftSection={<SaveIcon size={16} />}>
          {t("siteConfig.action.saveAll")}
        </Button>
      </aside>

      <div className="site-config-content">
        <div className="site-config-overview-grid">
          <section id="site-config-branding" className="site-config-card site-config-card--branding">
            <div className="site-config-card__header">
              <div className="site-config-title-row">
                <Text fw={800}>{t("siteConfig.branding.title")}</Text>
                <SiteConfigInfo
                  title={t("siteConfig.branding.title")}
                  description={t("siteConfig.branding.description")}
                  icon={<GalleryThumbnailsIcon size={16} />}
                  color="gray"
                />
              </div>
            </div>

            <div className="site-config-brand-block">
              <div className="site-config-logo-preview">
                {siteLogoUrl ? (
                  <img src={siteLogoUrl} alt={t("siteConfig.field.siteLogo")} />
                ) : (
                  <GalleryThumbnailsIcon size={34} />
                )}
              </div>
              <div className="site-config-brand-fields">
                <TextInput size="sm" label={t("siteConfig.field.siteName")} value={siteName} onChange={(event) => setSiteName(event.currentTarget.value)} />
                <div className="site-config-logo-upload">
                  <div className="site-config-title-row">
                    <Text size="sm" fw={700}>{t("siteConfig.field.siteLogo")}</Text>
                    <SiteConfigInfo
                      title={t("siteConfig.field.siteLogo")}
                      description={t("siteConfig.field.siteLogoDescription")}
                      icon={<UploadIcon size={16} />}
                      color="gray"
                    />
                  </div>
                  <FileButton onChange={(file) => { if (file) onUploadLogo(file); }} accept="image/jpeg,image/png,image/gif,image/webp,image/avif">
                    {(buttonProps) => (
                      <Button size="sm" variant="default" loading={logoUploading} leftSection={<UploadIcon size={16} />} {...buttonProps}>
                        {t("siteConfig.action.uploadLogo")}
                      </Button>
                    )}
                  </FileButton>
                </div>
              </div>
            </div>
          </section>

          <section id="site-config-features" className="site-config-card site-config-card--features">
            <div className="site-config-card__header">
              <div className="site-config-title-row">
                <Text fw={800}>{t("siteConfig.policy.features")}</Text>
                <SiteConfigInfo
                  title={t("siteConfig.policy.features")}
                  description={t("siteConfig.policy.featuresDescription")}
                  icon={<SettingsIcon size={16} />}
                  color="gray"
                />
              </div>
              <Text size="xs" fw={700} c="dimmed">{t("siteConfig.summary.features", { enabled: enabledFeatureCount, total: FEATURE_KEYS.length })}</Text>
            </div>

            <div className="site-config-feature-grid">
              {FEATURE_KEYS.map((key) => (
                <div key={key} className="site-config-feature-card">
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
                      setFeatures((current) => ({ ...current, [key]: checked }));
                    }}
                    aria-label={t(`siteConfig.feature.${key}`)}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        <section id="site-config-limits" className="site-config-card site-config-card--limits">
          <div className="site-config-card__header">
            <div className="site-config-title-row">
              <Text fw={800}>{t("siteConfig.policy.limits")}</Text>
              <SiteConfigInfo
                title={t("siteConfig.policy.limits")}
                description={t("siteConfig.policy.limitsDescription")}
                icon={<CloudIcon size={16} />}
                color="gray"
              />
            </div>
          </div>

          <div className="site-config-limits-sections">
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
                    max={formatMb(MAX_CONFIGURABLE_MEDIA_FILE_BYTES)}
                    suffix=" MB"
                    hideControls
                    onChange={(next) => setMediaPolicy((current) => ({
                      ...current,
                      max_file_size_bytes: {
                        ...current.max_file_size_bytes,
                        [key]: numberOr(next, formatMb(value)) * 1024 * 1024,
                      },
                    }))}
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
                    onChange={(next) => setMediaPolicy((current) => ({
                      ...current,
                      quotas: { ...current.quotas, [key]: numberOr(next, value) },
                    }))}
                  />
                ))}
                <NumberInput
                  size="sm"
                  hideControls
                  label={t("siteConfig.storage.imagesPerItem")}
                  value={storagePolicy.images_per_item}
                  min={1}
                  max={LIMITS.content.storageImagesPerItem.max}
                  onChange={(next) => setStoragePolicy((current) => ({ ...current, images_per_item: numberOr(next, current.images_per_item) }))}
                />
              </SimpleGrid>
            </Stack>

            <Stack gap={12} className="site-config-subpanel">
              <Text size="sm" fw={700}>{t("siteConfig.policy.absences")}</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <NumberInput
                  size="sm"
                  hideControls
                  label={t("siteConfig.absence.maxSpanDays")}
                  value={absencePolicy.max_span_days}
                  min={1}
                  max={LIMITS.content.absenceSpanDays.max}
                  onChange={(next) => setAbsencePolicy((current) => ({
                    ...current,
                    max_span_days: numberOr(next, current.max_span_days),
                  }))}
                />
                <NumberInput
                  size="sm"
                  hideControls
                  label={t("siteConfig.absence.maxEntriesPerUser")}
                  value={absencePolicy.max_entries_per_user}
                  min={1}
                  max={LIMITS.content.absencesPerUser.max}
                  onChange={(next) => setAbsencePolicy((current) => ({
                    ...current,
                    max_entries_per_user: numberOr(next, current.max_entries_per_user),
                  }))}
                />
              </SimpleGrid>
            </Stack>
          </div>
        </section>
      </div>
    </div>
  );
}
