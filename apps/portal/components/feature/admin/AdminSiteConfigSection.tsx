import {
  DEFAULT_FEATURE_FLAGS,
  IMAGE_FILE_ACCEPT,
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

type SiteConfigInfoProps = {
  title: string;
  description: string;
  icon: ReactNode;
  color?: string;
  badge?: string;
};

type EditableSiteConfig = {
  site_name: string;
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
  const features = data.site.features ?? DEFAULT_FEATURE_FLAGS;
  const mediaPolicy = data.site.media_policy ?? DEFAULT_SITE_MEDIA_POLICY;
  const storagePolicy = data.site.storage_policy ?? DEFAULT_SITE_STORAGE_POLICY;
  const absencePolicy = data.site.absence_policy ?? DEFAULT_SITE_ABSENCE_POLICY;
  return {
    site_name: data.site.site_name,
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
  const [siteLogoUrl, setSiteLogoUrl] = useState("");
  const [features, setFeatures] = useState<FeatureFlags>({ ...DEFAULT_FEATURE_FLAGS });
  const [mediaPolicy, setMediaPolicy] = useState<AdminSiteConfigResponse["site"]["media_policy"]>(DEFAULT_SITE_MEDIA_POLICY);
  const [storagePolicy, setStoragePolicy] = useState<AdminSiteConfigResponse["site"]["storage_policy"]>(DEFAULT_SITE_STORAGE_POLICY);
  const [absencePolicy, setAbsencePolicy] = useState<AdminSiteConfigResponse["site"]["absence_policy"]>(DEFAULT_SITE_ABSENCE_POLICY);
  const [baselineConfig, setBaselineConfig] = useState<EditableSiteConfig | null>(null);

  useEffect(() => {
    if (!data) return;
    const nextConfig = copyEditableConfig(data);
    setSiteName(nextConfig.site_name);
    setSiteLogoUrl(data.site.site_logo_url);
    setFeatures(nextConfig.features);
    setMediaPolicy(nextConfig.media_policy);
    setStoragePolicy(nextConfig.storage_policy);
    setAbsencePolicy(nextConfig.absence_policy);
    setBaselineConfig(nextConfig);
  }, [data]);

  const currentConfig: EditableSiteConfig = {
    site_name: siteName,
    features,
    media_policy: mediaPolicy,
    storage_policy: storagePolicy,
    absence_policy: absencePolicy,
  };
  const hasPendingChanges = baselineConfig !== null
    && !areEditableConfigsEqual(currentConfig, baselineConfig);
  const canSave = hasPendingChanges
    && siteName.trim().length > 0
    && !saving;
  const enabledFeatureCount = FEATURE_KEYS.filter((key) => features[key]).length;

  if (loading) {
    return <Text c="dimmed">{t("common:loading")}</Text>;
  }

  const handleSave = () => {
    if (!canSave) return;
    onSaveSite(currentConfig);
  };

  return (
    /*
     * 单列。原先是「左边一条 220-260px 的二级导航 + 右边内容」，那条导航只有三项，
     * 靠 <a href="#site-config-…"> 跳锚点——在 SPA 里点它会把 hash 写进地址栏，
     * 而路由的 tab 参数也在 URL 上，来回点几次浏览器的后退键就退不回上一个页签了。
     * 三个卡片顺着往下排，滚一屏就到底，用不着二级导航。
     */
    <div className="site-config">
      <section id="site-config-branding" className="site-config-card">
        <div className="site-config-card__header">
          <div className="site-config-title-row">
            <Text fw={800} className="site-config-card__title">{t("siteConfig.branding.title")}</Text>
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
              <GalleryThumbnailsIcon size={28} />
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
              <FileButton onChange={(file) => { if (file) onUploadLogo(file); }} accept={IMAGE_FILE_ACCEPT}>
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

      <section id="site-config-features" className="site-config-card">
        <div className="site-config-card__header">
          <div className="site-config-title-row">
            <Text fw={800} className="site-config-card__title">{t("siteConfig.policy.features")}</Text>
            <SiteConfigInfo
              title={t("siteConfig.policy.features")}
              description={t("siteConfig.policy.featuresDescription")}
              icon={<SettingsIcon size={16} />}
              color="gray"
            />
          </div>
          {/* c="dimmed" 去掉了：底色改成品牌浅底之后，灰字压在上面对比度不够。 */}
          <Text size="xs" fw={700} className="site-config-count">{t("siteConfig.summary.compact", { enabled: enabledFeatureCount, total: FEATURE_KEYS.length })}</Text>
        </div>

        {/* 一行一个开关。原先是四列卡片网格，开关被推到每张卡的右缘，
            名字和它管的那个开关之间隔着一段空白，扫一眼对不上。 */}
        <div className="site-config-feature-list">
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
                  setFeatures((current) => ({ ...current, [key]: checked }));
                }}
                aria-label={t(`siteConfig.feature.${key}`)}
              />
            </div>
          ))}
        </div>
      </section>

      <section id="site-config-limits" className="site-config-card">
        <div className="site-config-card__header">
          <div className="site-config-title-row">
            <Text fw={800} className="site-config-card__title">{t("siteConfig.policy.limits")}</Text>
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
        </div>
      </section>

      {/*
        * 保存条只在有改动时才出现。原先它是侧栏底部一个常驻按钮，绝大多数时候是灰的——
        * 一个永远在那里、九成时间点不动的控件，既占位置又不告诉人「现在到底有没有东西要存」。
        * 出现即代表「有未保存的改动」；名字填成空白时它仍然在，只是按钮禁用，
        * 这样「有改动但存不了」和「没有改动」是两种看得出区别的状态。
        */}
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
