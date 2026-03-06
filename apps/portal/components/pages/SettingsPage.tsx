import { listThemeIds, resolveThemeSpec } from "@infini-dev-kit/frontend/theme/theme-specs";
import { IconSettings } from "@tabler/icons-react";
import type { ThemeId } from "@infini-dev-kit/frontend/theme/theme-types";
import { useBridge, useThemeSnapshot } from "@infini-dev-kit/frontend/provider";
import {
  AnimatedTabs,
  ShinyText,
} from "@infini-dev-kit/frontend/components";
import { SimpleGrid, Stack, Switch, Text, UnstyledButton } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePreferencesStore } from "../../stores/preferences";
import { PageLayout } from "../layout/PageLayout";

type MotionMode = "off" | "minimum" | "reduced" | "full";

const MOTION_KEYS: MotionMode[] = ["off", "minimum", "reduced", "full"];

const sectionStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid var(--infini-color-border, rgba(255,255,255,0.08))",
  background: "var(--infini-color-surface, rgba(255,255,255,0.03))",
  padding: "20px",
};

/* ── Theme swatch component ── */

function ThemeSwatch({
  themeId,
  isActive,
  onSelect,
}: {
  themeId: ThemeId;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation("settings");
  const spec = resolveThemeSpec(themeId);
  const swatch = {
    accent: spec.palette.accent,
    secondary: spec.palette.secondary,
    gradient: `linear-gradient(135deg, ${spec.foundation.background} 0%, ${spec.foundation.surfaceAccent} 42%, ${spec.palette.primary} 100%)`,
  };

  return (
    <UnstyledButton
      type="button"
      onClick={onSelect}
      className="theme-swatch-button"
      aria-label={t("theme.aria.useTheme", { themeId })}
      aria-pressed={isActive}
      style={{ width: "100%" }}
    >
      <div
        style={{
          width: "100%",
          minHeight: 72,
          borderRadius: 12,
          background: swatch.gradient,
          border: isActive ? `2px solid ${swatch.accent}` : `1px solid ${swatch.accent}33`,
          boxShadow: isActive
            ? `0 0 20px ${swatch.accent}44, 0 0 40px ${swatch.accent}11`
            : "none",
          position: "relative",
          overflow: "hidden",
          transition:
            "box-shadow var(--infini-motion-hover, 140ms) var(--infini-motion-easing, ease), border-color var(--infini-motion-hover, 140ms) var(--infini-motion-easing, ease)",
        }}
      >
        {/* Accent dot indicators */}
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            display: "flex",
            gap: 4,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: swatch.accent, opacity: 0.9 }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: swatch.secondary, opacity: 0.9 }} />
        </div>
      </div>

      <Text
        size="xs"
        mt={8}
        fw={isActive ? 600 : 400}
        ta="center"
        style={{
          color: isActive ? swatch.accent : undefined,
          opacity: isActive ? 1 : 0.6,
          transition:
            "color var(--infini-motion-hover, 140ms) var(--infini-motion-easing, ease), opacity var(--infini-motion-hover, 140ms) var(--infini-motion-easing, ease)",
        }}
      >
        {t(`theme.${themeId}`, { defaultValue: themeId })}
      </Text>
    </UnstyledButton>
  );
}

/* ── Motion mode selector ── */

function MotionModeSelector({
  value,
  onChange,
}: {
  value: MotionMode;
  onChange: (mode: MotionMode) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
      {MOTION_KEYS.map((key) => (
        <UnstyledButton
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            border: value === key ? "2px solid var(--infini-color-primary, #3b82f6)" : "1px solid var(--infini-color-border, #333)",
            background: value === key ? "var(--infini-color-primary-alpha, rgba(59,130,246,0.08))" : "transparent",
            transition:
              "all var(--infini-motion-hover, 140ms) var(--infini-motion-easing, ease)",
          }}
        >
          <Text size="sm" fw={value === key ? 600 : 400}>
            {t(`motion.${key}`)}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {t(`motion.${key}.desc`)}
          </Text>
        </UnstyledButton>
      ))}
    </SimpleGrid>
  );
}

/* ── Main Settings Page ── */

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const bridge = useBridge();
  const snapshot = useThemeSnapshot();
  const themeIds = useMemo(() => listThemeIds(), []);
  const motionMode = snapshot.state.motionMode as MotionMode;

  const {
    locale,
    setLocale,
    fancyEffects,
    setFancyEffects,
    pushNotificationSound,
    setPushNotificationSound,
  } = usePreferencesStore();

  const onThemeChange = (nextThemeId: ThemeId) => {
    bridge.setTheme(nextThemeId);
  };

  const onMotionChange = (nextMode: MotionMode) => {
    bridge.setMotionMode(nextMode);
  };

  /* ── Tab content ── */

  const appearanceTab = (
    <Stack gap="lg">
      {/* Theme picker */}
      <div style={sectionStyle}>
        <Stack gap="md">
          <Text size="lg" fw={600}>{t("field.theme")}</Text>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }} spacing="md">
            {themeIds.map((themeId) => (
              <ThemeSwatch
                key={themeId}
                themeId={themeId as ThemeId}
                isActive={snapshot.state.themeId === themeId}
                onSelect={() => onThemeChange(themeId as ThemeId)}
              />
            ))}
          </SimpleGrid>
        </Stack>
      </div>

      {/* Motion mode */}
      <div style={sectionStyle}>
        <Stack gap="md">
          <Text size="lg" fw={600}>{t("field.motion")}</Text>
          <MotionModeSelector value={motionMode} onChange={onMotionChange} />
        </Stack>
      </div>
    </Stack>
  );

  const preferencesTab = (
    <Stack gap="lg">
      {/* Language */}
      <div style={sectionStyle}>
        <Stack gap="md">
          <Text size="lg" fw={600}>{t("field.locale")}</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {([
              { value: "en" as const, label: "English", sub: "Default language" },
              { value: "zh" as const, label: "中文", sub: "Chinese (Simplified)" },
            ] as const).map((opt) => (
              <UnstyledButton
                key={opt.value}
                onClick={() => setLocale(opt.value)}
                style={{
                  padding: "14px 18px",
                  borderRadius: 10,
                  border: locale === opt.value ? "2px solid var(--infini-color-primary, #3b82f6)" : "1px solid var(--infini-color-border, #333)",
                  background: locale === opt.value ? "var(--infini-color-primary-alpha, rgba(59,130,246,0.08))" : "transparent",
                  transition:
                    "all var(--infini-motion-hover, 140ms) var(--infini-motion-easing, ease)",
                }}
              >
                <Text size="sm" fw={locale === opt.value ? 600 : 400}>
                  {opt.label}
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  {opt.sub}
                </Text>
              </UnstyledButton>
            ))}
          </SimpleGrid>
        </Stack>
      </div>

      <div style={sectionStyle}>
        <Stack gap="sm">
          <Text size="lg" fw={600}>{t("description")}</Text>
          <Switch
            checked={fancyEffects}
            onChange={(event) => setFancyEffects(event.currentTarget.checked)}
            label={t("field.fancyEffects")}
          />
          <Text size="xs" c="dimmed">
            {t("fancyEffects.description")}
          </Text>
          <Switch
            checked={pushNotificationSound}
            onChange={(event) => setPushNotificationSound(event.currentTarget.checked)}
            label={t("field.pushNotificationSound")}
          />
          <Text size="xs" c="dimmed">
            {t("pushNotificationSound.description")}
          </Text>
        </Stack>
      </div>
    </Stack>
  );

  const tabItems = useMemo(
    () => [
      { key: "appearance", label: t("field.theme"), content: appearanceTab },
      { key: "preferences", label: t("field.locale"), content: preferencesTab },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      snapshot.state.themeId,
      motionMode,
      locale,
      themeIds,
      t,
    ],
  );

  return (
    <PageLayout
      title={t("title")}
      subtitle={
        <ShinyText duration={4} style={{ fontSize: 14, opacity: 0.8 }}>
          {t("subtitle")}
        </ShinyText>
      }
      icon={<IconSettings size={22} />}
    >
      <AnimatedTabs
        items={tabItems}
        defaultActiveKey="appearance"
        contentTransition="slide"
      />
    </PageLayout>
  );
}
