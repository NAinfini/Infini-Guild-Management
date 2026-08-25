import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LanguageIcon } from "@portal/components/icons";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";

import { PageLayout } from "../layout/PageLayout";
import { useTheme } from "../../providers/ThemeProvider";
import { usePreferencesStore } from "../../stores/preferences";
import "./SettingsPage.css";

type Accent = "teal" | "indigo" | "violet" | "orange";

type OptionCardProps<Value extends string> = {
  value: Value;
  label: string;
  description: string;
  visual: ReactNode;
  visualKind: "icon" | "sample";
};

function OptionCard<Value extends string>({
  value,
  label,
  description,
  visual,
  visualKind,
}: OptionCardProps<Value>) {
  return (
    <label className="settings-option-card">
      <span
        className={`settings-option-card__visual settings-option-card__visual--${visualKind}`}
        aria-hidden="true"
      >
        {visual}
      </span>
      <span className="settings-option-card__content">
        <span className="settings-option-card__label">{label}</span>
        <span className="settings-option-card__description">{description}</span>
      </span>
      <RadioGroupItem value={value} className="settings-option-card__radio" />
    </label>
  );
}

function SurfaceSample({
  theme,
  accent,
}: {
  theme?: "light" | "dark";
  accent?: Accent;
}) {
  return (
    <span
      className="settings-surface-sample"
      data-theme={theme}
      data-accent-preview={accent}
    >
      <span className="settings-surface-sample__rail" />
      <span className="settings-surface-sample__panel">
        <span className="settings-surface-sample__line" />
        <span className="settings-surface-sample__line settings-surface-sample__line--short" />
        <span className="settings-surface-sample__accent" />
      </span>
    </span>
  );
}

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
    if (nextLocale !== locale) setLocale(nextLocale);
  }, [locale, setLocale]);

  return (
    <PageLayout>
      <div className="settings-page">
        <fieldset className="settings-section settings-section--appearance">
          <legend className="settings-section__legend">{t("section.appearance")}</legend>
          <div className="settings-section__content">
            <div className="settings-field-group">
              <p id="settings-theme-label" className="settings-field-label">{t("field.theme")}</p>
              <RadioGroup
                aria-labelledby="settings-theme-label"
                value={currentTheme}
                onValueChange={(nextTheme) => setTheme(nextTheme)}
                className="settings-choice-grid settings-choice-grid--binary"
              >
                <OptionCard
                  value="light"
                  label={t("theme.light")}
                  description={t("theme.light.desc")}
                  visual={<SurfaceSample theme="light" />}
                  visualKind="sample"
                />
                <OptionCard
                  value="dark"
                  label={t("theme.dark")}
                  description={t("theme.dark.desc")}
                  visual={<SurfaceSample theme="dark" />}
                  visualKind="sample"
                />
              </RadioGroup>
            </div>

            <div className="settings-field-group">
              <p id="settings-accent-label" className="settings-field-label">{t("field.accent")}</p>
              <RadioGroup
                aria-labelledby="settings-accent-label"
                value={accent}
                onValueChange={(nextAccent) => setAccent(nextAccent)}
                className="settings-choice-grid settings-choice-grid--accent"
              >
                {ACCENT_OPTIONS.map((option) => (
                  <OptionCard
                    key={option.value}
                    value={option.value}
                    label={t(option.labelKey)}
                    description={t(option.descKey)}
                    visual={<SurfaceSample accent={option.value} />}
                    visualKind="sample"
                  />
                ))}
              </RadioGroup>
            </div>
          </div>
        </fieldset>

        <fieldset className="settings-section settings-section--preferences">
          <legend className="settings-section__legend">{t("section.preferences")}</legend>
          <div className="settings-section__content">
            <div className="settings-field-group">
              <p id="settings-locale-label" className="settings-field-label">{t("field.locale")}</p>
              <RadioGroup
                aria-labelledby="settings-locale-label"
                value={locale}
                onValueChange={handleLocaleChange}
                className="settings-choice-grid settings-choice-grid--binary"
              >
                <OptionCard
                  value="en"
                  label={t("locale.en")}
                  description={t("locale.en.desc")}
                  visual={<LanguageIcon size={20} />}
                  visualKind="icon"
                />
                <OptionCard
                  value="zh"
                  label={t("locale.zh")}
                  description={t("locale.zh.desc")}
                  visual={<LanguageIcon size={20} />}
                  visualKind="icon"
                />
              </RadioGroup>
            </div>
          </div>
        </fieldset>
      </div>
    </PageLayout>
  );
}
