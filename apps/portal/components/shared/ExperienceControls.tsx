import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@portal/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { useTheme } from "../../providers/ThemeProvider";
import { usePreferencesStore } from "../../stores/preferences";
import { buildLocaleOptions } from "../../utils/locales";
import {
  EllipsisOutlined,
  MoonOutlined,
  SunOutlined,
  TranslationOutlined,
} from "../../utils/icons";
import "./ExperienceControls.css";

type ExperienceControlsProps = {
  compact?: boolean;
};

export function ExperienceControls({ compact = false }: ExperienceControlsProps) {
  const { t } = useTranslation("common");
  const { theme, toggleTheme } = useTheme();
  const locale = usePreferencesStore((state) => state.locale);
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const localeOptions = useMemo(() => buildLocaleOptions((key) => t(key)), [t]);
  const ThemeIcon = theme === "dark" ? SunOutlined : MoonOutlined;

  const localeItems = localeOptions.map((option) => (
    <DropdownMenuRadioItem key={option.value} value={option.value}>
      {option.label}
    </DropdownMenuRadioItem>
  ));

  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="experience-controls__button"
              aria-label={t("nav.openGlobalTools")}
            />
          )}
        >
            <EllipsisOutlined aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[13.75rem]">
          <DropdownMenuItem onClick={toggleTheme}>
            <ThemeIcon aria-hidden="true" />
            {t("label.theme")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("label.locale")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={locale} onValueChange={setLocale}>
            {localeItems}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="experience-controls">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="experience-controls__button"
        aria-label={t("label.theme")}
        onClick={toggleTheme}
      >
        <ThemeIcon aria-hidden="true" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={(
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="experience-controls__button"
              aria-label={t("label.locale")}
            />
          )}
        >
            <TranslationOutlined aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[11.25rem]">
          <DropdownMenuRadioGroup value={locale} onValueChange={setLocale}>
            {localeItems}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
