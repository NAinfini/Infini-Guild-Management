import { useCallback } from "react";
import { Button, Group, SimpleGrid, Stack, Switch, Text, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { FileImportIcon, LanguageIcon, MoonIcon, RefreshCwIcon, SaveIcon, SettingsIcon, SunIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { ShinyText } from "@portal/components/effects";

import { PageLayout } from "../layout/PageLayout";
import { usePreferencesStore } from "../../stores/preferences";
import { useTheme } from "../../providers/ThemeProvider";
import { notifySuccess } from "../../utils/notifications";
import "./SettingsPage.css";

type MotionMode = "off" | "minimum" | "reduced" | "full";

type OptionCardProps = {
  active: boolean;
  onClick: () => void;
  label: string;
  description?: string;
  icon?: React.ReactNode;
};

function OptionCard({ active, onClick, label, description, icon }: OptionCardProps) {
  const cls = [
    "settings-option-card",
    icon ? "settings-option-card--with-icon" : "",
    active ? "settings-option-card--active" : "",
  ].filter(Boolean).join(" ");

  return (
    <button type="button" className={cls} onClick={onClick}>
      {icon ? <div className="settings-option-card__icon">{icon}</div> : null}
      <div className="settings-option-card__content">
        <Text size="sm" fw={active ? 600 : 400}>{label}</Text>
        {description ? <Text size="xs" c="dimmed">{description}</Text> : null}
      </div>
    </button>
  );
}

const MOTION_OPTIONS: { value: MotionMode; labelKey: string; descKey: string }[] = [
  { value: "off", labelKey: "motion.off", descKey: "motion.off.desc" },
  { value: "minimum", labelKey: "motion.minimum", descKey: "motion.minimum.desc" },
  { value: "reduced", labelKey: "motion.reduced", descKey: "motion.reduced.desc" },
  { value: "full", labelKey: "motion.full", descKey: "motion.full.desc" },
];

function exportSettings(prefs: { locale: string; motionMode: string; fancyEffects: boolean; pushNotificationSound: boolean }, theme: string) {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    theme,
    locale: prefs.locale,
    motionMode: prefs.motionMode,
    fancyEffects: prefs.fancyEffects,
    pushNotificationSound: prefs.pushNotificationSound,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `infini-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function isValidSettingsFile(data: unknown): data is {
  version: number;
  theme?: string;
  locale?: string;
  motionMode?: string;
  fancyEffects?: boolean;
  pushNotificationSound?: boolean;
} {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.version === "number" && obj.version === 1;
}

export function SettingsPage() {
  const { t, i18n } = useTranslation("settings");

  const {
    locale,
    setLocale,
    motionMode,
    setMotionMode,
    fancyEffects,
    setFancyEffects,
    pushNotificationSound,
    setPushNotificationSound,
    resetPreferences,
  } = usePreferencesStore();

  const { theme: currentTheme, setTheme } = useTheme();

  const handleLocaleChange = useCallback((nextLocale: "en" | "zh") => {
    if (nextLocale === locale) return;
    setLocale(nextLocale);
    void i18n.changeLanguage(nextLocale);
  }, [locale, setLocale, i18n]);

  const handleExport = useCallback(() => {
    exportSettings({ locale, motionMode, fancyEffects, pushNotificationSound }, currentTheme);
    notifySuccess(t("backup.exported"));
  }, [locale, motionMode, fancyEffects, pushNotificationSound, currentTheme, t]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data: unknown = JSON.parse(text);
        if (!isValidSettingsFile(data)) throw new Error("invalid");

        if (data.theme === "light" || data.theme === "dark") setTheme(data.theme);
        if (data.locale === "en" || data.locale === "zh") {
          setLocale(data.locale);
          void i18n.changeLanguage(data.locale);
        }
        if (data.motionMode === "off" || data.motionMode === "minimum" || data.motionMode === "reduced" || data.motionMode === "full") {
          setMotionMode(data.motionMode as MotionMode);
        }
        if (typeof data.fancyEffects === "boolean") setFancyEffects(data.fancyEffects);
        if (typeof data.pushNotificationSound === "boolean") setPushNotificationSound(data.pushNotificationSound);

        notifySuccess(t("backup.imported"));
      } catch {
        notifications.show({ color: "red", title: t("backup.importFailedTitle"), message: t("backup.importFailed") });
      }
    };
    input.click();
  }, [setTheme, setLocale, setMotionMode, setFancyEffects, setPushNotificationSound, i18n, t]);

  const handleReset = useCallback(() => {
    modals.openConfirmModal({
      title: t("reset.confirmTitle"),
      children: <Text size="sm">{t("reset.confirm")}</Text>,
      confirmProps: { color: "red" },
      labels: { confirm: t("reset.button"), cancel: t("common:action.cancel") },
      onConfirm: () => {
        resetPreferences();
        setTheme("light");
        void i18n.changeLanguage("en");
        notifySuccess(t("reset.success"));
      },
      centered: true,
    });
  }, [resetPreferences, setTheme, i18n, t]);

  return (
    <PageLayout
      title={t("title")}
      subtitle={
        <ShinyText duration={4} style={{ fontSize: 14, opacity: 0.8 }}>
          {t("subtitle")}
        </ShinyText>
      }
      icon={<SettingsIcon size={22} />}
    >
      <Stack gap="xl">
        {/* ── Appearance ── */}
        <div className="settings-section">
          <Title order={2} className="settings-section__title">{t("section.appearance")}</Title>
          <Stack gap="lg">
            {/* Theme */}
            <div>
              <Text size="sm" fw={600} mb={8}>{t("field.theme")}</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <OptionCard
                  active={currentTheme === "light"}
                  onClick={() => setTheme("light")}
                  label={t("theme.light")}
                  description={t("theme.light.desc")}
                  icon={<SunIcon size={20} />}
                />
                <OptionCard
                  active={currentTheme === "dark"}
                  onClick={() => setTheme("dark")}
                  label={t("theme.dark")}
                  description={t("theme.dark.desc")}
                  icon={<MoonIcon size={20} />}
                />
              </SimpleGrid>
            </div>

            {/* Motion */}
            <div>
              <Text size="sm" fw={600} mb={8}>{t("field.motion")}</Text>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                {MOTION_OPTIONS.map((opt) => (
                  <OptionCard
                    key={opt.value}
                    active={motionMode === opt.value}
                    onClick={() => setMotionMode(opt.value)}
                    label={t(opt.labelKey)}
                    description={t(opt.descKey)}
                  />
                ))}
              </SimpleGrid>
            </div>
          </Stack>
        </div>

        {/* ── Preferences ── */}
        <div className="settings-section">
          <Title order={2} className="settings-section__title">{t("section.preferences")}</Title>
          <Stack gap="lg">
            {/* Language */}
            <div>
              <Text size="sm" fw={600} mb={8}>{t("field.locale")}</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <OptionCard
                  active={locale === "en"}
                  onClick={() => handleLocaleChange("en")}
                  label={t("locale.en")}
                  description={t("locale.en.desc")}
                  icon={<LanguageIcon size={20} />}
                />
                <OptionCard
                  active={locale === "zh"}
                  onClick={() => handleLocaleChange("zh")}
                  label={t("locale.zh")}
                  description={t("locale.zh.desc")}
                  icon={<LanguageIcon size={20} />}
                />
              </SimpleGrid>
            </div>

            {/* Toggles */}
            <div>
              <div className="settings-switch-row">
                <Switch
                  aria-label={t("field.fancyEffects")}
                  checked={fancyEffects}
                  onChange={(e) => setFancyEffects(e.currentTarget.checked)}
                />
                <div className="settings-switch-row__content">
                  <Text size="sm" fw={500}>{t("field.fancyEffects")}</Text>
                  <Text size="xs" c="dimmed">{t("fancyEffects.description")}</Text>
                </div>
              </div>
              <div className="settings-switch-row">
                <Switch
                  aria-label={t("field.pushNotificationSound")}
                  checked={pushNotificationSound}
                  onChange={(e) => setPushNotificationSound(e.currentTarget.checked)}
                />
                <div className="settings-switch-row__content">
                  <Text size="sm" fw={500}>{t("field.pushNotificationSound")}</Text>
                  <Text size="xs" c="dimmed">{t("pushNotificationSound.description")}</Text>
                </div>
              </div>
            </div>
          </Stack>
        </div>

        {/* ── Backup & Reset ── */}
        <div className="settings-section">
          <Title order={2} className="settings-section__title">{t("field.backup")}</Title>
          <Text size="sm" c="dimmed" mb={12}>{t("backup.description")}</Text>
          <div className="settings-backup-actions">
            <Button
              variant="default"
              leftSection={<SaveIcon size={16} />}
              onClick={handleExport}
            >
              {t("backup.export")}
            </Button>
            <Button
              variant="default"
              leftSection={<FileImportIcon size={16} />}
              onClick={handleImport}
            >
              {t("backup.import")}
            </Button>
          </div>
          <div className="settings-reset-zone">
            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">{t("reset.confirm")}</Text>
              <Button
                variant="default"
                color="red"
                leftSection={<RefreshCwIcon size={16} />}
                onClick={handleReset}
              >
                {t("reset.button")}
              </Button>
            </Group>
          </div>
        </div>
      </Stack>
    </PageLayout>
  );
}
