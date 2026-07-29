import { useCallback } from "react";
import { Fieldset, SimpleGrid, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { LanguageIcon, MoonIcon, SunIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../layout/PageLayout";
import { usePreferencesStore } from "../../stores/preferences";
import { useTheme } from "../../providers/ThemeProvider";
import "./SettingsPage.css";

type Accent = "teal" | "indigo" | "violet" | "orange";

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
    <UnstyledButton type="button" className={cls} onClick={onClick} aria-pressed={active}>
      {icon ? <ThemeIcon variant="light" radius="md" className="settings-option-card__icon">{icon}</ThemeIcon> : null}
      <div className="settings-option-card__content">
        <Text size="sm" fw={active ? 600 : 400}>{label}</Text>
        {description ? <Text size="xs" c="dimmed">{description}</Text> : null}
      </div>
    </UnstyledButton>
  );
}

/* 每块色卡显示的是「那个选项的颜色」而不是当前生效的主色，配色走
 * SettingsPage.css 的 .settings-accent-swatch--<value>（转发 semantic.css 的
 * --accent-swatch-*），不能走 --accent-fill —— 那个会跟着 [data-accent] 一起变，
 * 四块会同时变成同一个颜色。 */
const ACCENT_OPTIONS: { value: Accent; labelKey: string; descKey: string }[] = [
  { value: "teal", labelKey: "accent.teal", descKey: "accent.teal.desc" },
  { value: "indigo", labelKey: "accent.indigo", descKey: "accent.indigo.desc" },
  { value: "violet", labelKey: "accent.violet", descKey: "accent.violet.desc" },
  { value: "orange", labelKey: "accent.orange", descKey: "accent.orange.desc" },
];

export function SettingsPage() {
  const { t } = useTranslation("settings");

  const { locale, setLocale } = usePreferencesStore();

  const { theme: currentTheme, setTheme, accent, setAccent } = useTheme();

  const handleLocaleChange = useCallback((nextLocale: "en" | "zh") => {
    if (nextLocale === locale) return;
    setLocale(nextLocale);
  }, [locale, setLocale]);

  return (
    <PageLayout>
      <Stack gap="xl">
        {/* ── Appearance ── */}
        <Fieldset legend={t("section.appearance")} className="settings-section">
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

            {/* Accent */}
            <div>
              <Text size="sm" fw={600} mb={8}>{t("field.accent")}</Text>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                {ACCENT_OPTIONS.map((opt) => (
                  <OptionCard
                    key={opt.value}
                    active={accent === opt.value}
                    onClick={() => setAccent(opt.value)}
                    label={t(opt.labelKey)}
                    description={t(opt.descKey)}
                    icon={<span className={`settings-accent-swatch settings-accent-swatch--${opt.value}`} />}
                  />
                ))}
              </SimpleGrid>
            </div>
          </Stack>
        </Fieldset>

        {/* ── Preferences ── */}
        <Fieldset legend={t("section.preferences")} className="settings-section">
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
          </Stack>
        </Fieldset>
      </Stack>
    </PageLayout>
  );
}
