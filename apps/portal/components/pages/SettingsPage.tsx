import type { ReactNode } from "react";
import { useMemo } from "react";

import { SimpleGrid, Stack, Switch, Text, UnstyledButton } from "@mantine/core";
import { ShinyText } from "@portal/components/effects";
import { IconSettings } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../layout/PageLayout";
import { usePreferencesStore } from "../../stores/preferences";
import { useTheme } from "../../providers/ThemeProvider";

// NOTE: Theme system is simplified to dark/light via Dev Kit bridge.
// This page only surfaces settings that are currently wired in the app store.

type MotionMode = "off" | "minimum" | "reduced" | "full";

type MotionModeOption = {
  value: MotionMode;
  labelKey: string;
  descriptionKey: string;
};

const MOTION_OPTIONS: MotionModeOption[] = [
  { value: "off", labelKey: "motion.off", descriptionKey: "motion.off.desc" },
  { value: "minimum", labelKey: "motion.minimum", descriptionKey: "motion.minimum.desc" },
  { value: "reduced", labelKey: "motion.reduced", descriptionKey: "motion.reduced.desc" },
  { value: "full", labelKey: "motion.full", descriptionKey: "motion.full.desc" },
];

const sectionStyle: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid color-mix(in srgb, var(--color-border, #e5e7eb) 80%, transparent)",
  background: "var(--color-surface, #ffffff)",
  padding: "24px",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
};

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div style={sectionStyle}>
      <Stack gap="md">
        {typeof title === "string" ? (
          <Text size="lg" fw={600}>
            {title}
          </Text>
        ) : (
          title
        )}
        {children}
      </Stack>
    </div>
  );
}

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
      {MOTION_OPTIONS.map((option) => {
        const isActive = option.value === value;

        return (
          <UnstyledButton
            key={option.value}
            onClick={() => onChange(option.value)}
            style={{
              padding: "14px 18px",
              borderRadius: 12,
              border: isActive
                ? "2px solid var(--color-primary, #3b82f6)"
                : "1px solid color-mix(in srgb, var(--color-border, #e5e7eb) 80%, transparent)",
              background: isActive
                ? "color-mix(in srgb, var(--color-primary, #3b82f6) 6%, var(--color-surface, #ffffff))"
                : "var(--color-surface, #ffffff)",
              transition: "all 160ms ease",
              boxShadow: isActive
                ? "0 0 0 1px color-mix(in srgb, var(--color-primary, #3b82f6) 12%, transparent)"
                : "none",
            }}
          >
            <Text size="sm" fw={isActive ? 600 : 400}>
              {t(option.labelKey)}
            </Text>
            <Text size="xs" c="dimmed" mt={2}>
              {t(option.descriptionKey)}
            </Text>
          </UnstyledButton>
        );
      })}
    </SimpleGrid>
  );
}

export function SettingsPage() {
  const { t: tSettings, i18n } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");

  const {
    locale,
    setLocale,
    motionMode,
    setMotionMode,
    fancyEffects,
    setFancyEffects,
    pushNotificationSound,
    setPushNotificationSound,
  } = usePreferencesStore();

  const { theme: currentTheme, setTheme } = useTheme();

  const onMotionChange = (nextMode: MotionMode) => {
    if (nextMode === motionMode) return;
    setMotionMode(nextMode);
  };

  const onLocaleChange = (nextLocale: "en" | "zh") => {
    if (nextLocale === locale) return;
    setLocale(nextLocale);
    void i18n.changeLanguage(nextLocale);
  };

  const appearanceContent = useMemo(
    () => (
      <Stack gap="lg">
        <Section title={tCommon("settings.theme")}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {([
              { value: "light" as const, label: tCommon("settings.theme.light") },
              { value: "dark" as const, label: tCommon("settings.theme.dark") },
            ]).map((opt) => {
              const isActive = currentTheme === opt.value;

              return (
                <UnstyledButton
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  style={{
                    padding: "16px 20px",
                    borderRadius: 12,
                    border: isActive
                      ? "2px solid var(--color-primary, #3b82f6)"
                      : "1px solid color-mix(in srgb, var(--color-border, #e5e7eb) 80%, transparent)",
                    background: isActive
                      ? "color-mix(in srgb, var(--color-primary, #3b82f6) 6%, var(--color-surface, #ffffff))"
                      : "var(--color-surface, #ffffff)",
                    transition: "all 160ms ease",
                    boxShadow: isActive
                      ? "0 0 0 1px color-mix(in srgb, var(--color-primary, #3b82f6) 12%, transparent)"
                      : "none",
                  }}
                >
                  <Text size="sm" fw={isActive ? 600 : 400}>
                    {opt.label}
                  </Text>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>
        </Section>

        <Section title={tSettings("field.motion")}>
          <MotionModeSelector value={motionMode} onChange={onMotionChange} />
        </Section>
      </Stack>
    ),
    [currentTheme, setTheme, motionMode, onMotionChange, tSettings, tCommon],
  );

  const preferencesContent = useMemo(
    () => (
      <Stack gap="lg">
        <Section title={tSettings("field.locale")}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {([
              { value: "en" as const, label: "English", sub: "Default language" },
              { value: "zh" as const, label: "中文", sub: "Chinese (Simplified)" },
            ] as const).map((opt) => {
              const isActive = locale === opt.value;

              return (
                <UnstyledButton
                  key={opt.value}
                  onClick={() => onLocaleChange(opt.value)}
                  style={{
                    padding: "16px 20px",
                    borderRadius: 12,
                    border: isActive
                      ? "2px solid var(--color-primary, #3b82f6)"
                      : "1px solid color-mix(in srgb, var(--color-border, #e5e7eb) 80%, transparent)",
                    background: isActive
                      ? "color-mix(in srgb, var(--color-primary, #3b82f6) 6%, var(--color-surface, #ffffff))"
                      : "var(--color-surface, #ffffff)",
                    transition: "all 160ms ease",
                    boxShadow: isActive
                      ? "0 0 0 1px color-mix(in srgb, var(--color-primary, #3b82f6) 12%, transparent)"
                      : "none",
                  }}
                >
                  <Text size="sm" fw={isActive ? 600 : 400}>
                    {opt.label}
                  </Text>
                  <Text size="xs" c="dimmed" mt={2}>
                    {opt.sub}
                  </Text>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>
        </Section>

        <Section title={tSettings("description")}>
          <Stack gap="xs">
            <Switch
              checked={fancyEffects}
              onChange={(event) => setFancyEffects(event.currentTarget.checked)}
              label={tSettings("field.fancyEffects")}
            />
            <Text size="xs" c="dimmed">
              {tSettings("fancyEffects.description")}
            </Text>
            <Switch
              checked={pushNotificationSound}
              onChange={(event) => setPushNotificationSound(event.currentTarget.checked)}
              label={tSettings("field.pushNotificationSound")}
            />
            <Text size="xs" c="dimmed">
              {tSettings("pushNotificationSound.description")}
            </Text>
          </Stack>
        </Section>
      </Stack>
    ),
    [
      fancyEffects,
      locale,
      pushNotificationSound,
      setFancyEffects,
      setPushNotificationSound,
      tSettings,
    ],
  );

  return (
    <PageLayout
      title={tSettings("title")}
      subtitle={
        <ShinyText duration={4} style={{ fontSize: 14, opacity: 0.8 }}>
          {tSettings("subtitle")}
        </ShinyText>
      }
      icon={<IconSettings size={22} />}
    >
      <Stack gap="xl">
        {appearanceContent}
        {preferencesContent}
      </Stack>
    </PageLayout>
  );
}
