import type { NotificationPreferences } from "@guild/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LanguageIcon } from "@portal/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { Button } from "@portal/components/ui/button";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Switch } from "@portal/components/ui/switch";

import { PageLayout } from "../layout/PageLayout";
import { useTheme } from "../../providers/ThemeProvider";
import { usePreferencesStore } from "../../stores/preferences";
import { useAuthStore } from "../../stores/auth";
import { queryKeys } from "../../api/query-keys";
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from "../../services/NotificationService";
import { useAppError } from "../../hooks/useAppError";
import { useExternalView } from "../../hooks/useExternalView";
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

type NotificationPreferenceKey = Exclude<keyof NotificationPreferences, "updated_at">;
const NOTIFICATION_OPTIONS: NotificationPreferenceKey[] = [
  "member_joined",
  "announcement_published",
  "event_created",
  "wiki_article_created",
];

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const { locale, setLocale } = usePreferencesStore();
  const { theme: currentTheme, setTheme, accent, setAccent } = useTheme();
  const userId = useAuthStore((state) => state.user?.id);
  const isExternalView = useExternalView();
  const queryClient = useQueryClient();
  const { showError } = useAppError();

  const notificationPreferencesQuery = useQuery({
    queryKey: queryKeys.notifications.preferences(userId),
    queryFn: fetchNotificationPreferences,
    enabled: Boolean(userId) && !isExternalView,
  });
  const notificationPreferencesMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: NotificationPreferenceKey; enabled: boolean }) =>
      updateNotificationPreferences({ [key]: enabled }),
    onSuccess: (preferences) => {
      queryClient.setQueryData(queryKeys.notifications.preferences(userId), preferences);
    },
    onError: (error) => {
      showError(error, t("notification.saveFailed"));
    },
  });
  const notificationPreferencesBlockingError = notificationPreferencesQuery.isError
    && notificationPreferencesQuery.data === undefined;
  const notificationPreferencesRefreshError = notificationPreferencesQuery.isError
    && notificationPreferencesQuery.data !== undefined;

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

            {userId && !isExternalView ? (
              <div className="settings-field-group">
                <p id="settings-notifications-label" className="settings-field-label">
                  {t("field.notifications")}
                </p>
                <p className="settings-field-description">{t("notification.description")}</p>
                {notificationPreferencesQuery.isLoading ? (
                  <div className="settings-notification-list" aria-busy="true">
                    {NOTIFICATION_OPTIONS.map((key) => <Skeleton key={key} className="settings-notification-skeleton" />)}
                  </div>
                ) : notificationPreferencesBlockingError ? (
                  <Button type="button" variant="outline" onClick={() => { void notificationPreferencesQuery.refetch(); }}>
                    {t("notification.retry")}
                  </Button>
                ) : (
                  <>
                    {notificationPreferencesRefreshError ? (
                      <Alert variant="destructive">
                        <AlertTitle>{t("common:loadError")}</AlertTitle>
                        <AlertDescription>
                          <span>{t("common:loadErrorRetry")}</span>
                          <Button size="sm" variant="outline" loading={notificationPreferencesQuery.isFetching} onClick={() => { void notificationPreferencesQuery.refetch(); }}>
                            {t("notification.retry")}
                          </Button>
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <div className="settings-notification-list" aria-labelledby="settings-notifications-label">
                      {NOTIFICATION_OPTIONS.map((key) => (
                        <label key={key} className="settings-notification-row">
                          <span>
                            <strong>{t(`notification.${key}.label`)}</strong>
                            <small>{t(`notification.${key}.description`)}</small>
                          </span>
                          <Switch
                            checked={notificationPreferencesQuery.data?.[key] ?? true}
                            disabled={notificationPreferencesMutation.isPending}
                            onCheckedChange={(enabled) => notificationPreferencesMutation.mutate({ key, enabled })}
                          />
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : null}
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
