import type { ImportantNoticeAudienceRole } from "@guild/shared";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@portal/api/query-keys";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { PickList } from "@portal/components/shared/PickList";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Label } from "@portal/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { Switch } from "@portal/components/ui/switch";
import { fetchImportantNoticeAudienceRoles } from "@portal/services/NotificationService";
import type { Dispatch, SetStateAction } from "react";
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";

export type NoticeDraft = {
  id: string | null;
  revisionToken: string | null;
  title: string;
  bodyJson: string;
  publishAt: string;
  expiresAt: string;
  requiresAcknowledgement: boolean;
  audienceScope: "all" | "roles";
  audienceRoleIds: string[];
};

type AdminImportantNoticeDeliveryFieldsProps = Readonly<{
  draft: NoticeDraft;
  editable: boolean;
  hasValidAudience: boolean;
  expiryError?: string;
  setDraft: Dispatch<SetStateAction<NoticeDraft>>;
}>;

export function AdminImportantNoticeDeliveryFields({
  draft,
  editable,
  hasValidAudience,
  expiryError,
  setDraft,
}: AdminImportantNoticeDeliveryFieldsProps) {
  const { t } = useTranslation("admin");
  const { t: common } = useTranslation("common");
  const audienceDescriptionId = useId();
  const acknowledgementDescriptionId = useId();
  const audienceRolesQuery = useQuery({
    queryKey: queryKeys.importantNotices.audienceRoles(),
    queryFn: fetchImportantNoticeAudienceRoles,
    staleTime: 5 * 60_000,
  });
  const selectedAudienceRoleIds = useMemo(
    () => new Set(draft.audienceRoleIds),
    [draft.audienceRoleIds],
  );
  const audienceRoleOptions = useMemo(
    () => (audienceRolesQuery.data ?? []).map((role: ImportantNoticeAudienceRole) => ({
      id: role.id,
      label: role.name,
      disabled: !editable,
    })),
    [audienceRolesQuery.data, editable],
  );

  const toggleAudienceRole = (roleId: string) => {
    if (!editable) return;
    setDraft((current) => ({
      ...current,
      audienceRoleIds: current.audienceRoleIds.includes(roleId)
        ? current.audienceRoleIds.filter((id) => id !== roleId)
        : [...current.audienceRoleIds, roleId].sort(),
    }));
  };

  return (
    <div className="important-notices-admin__schedule">
      <section className="important-notices-admin__delivery-card">
        <div className="important-notices-admin__delivery-heading">
          <strong>{t("importantNotices.field.audience")}</strong>
          <span id={audienceDescriptionId}>{t("importantNotices.field.audienceDescription")}</span>
        </div>
        <RadioGroup
          className="important-notices-admin__audience-options"
          value={draft.audienceScope}
          aria-label={t("importantNotices.field.audience")}
          aria-describedby={audienceDescriptionId}
          onValueChange={(audienceScope) => {
            if (!editable) return;
            setDraft((current) => ({
              ...current,
              audienceScope: audienceScope as "all" | "roles",
              audienceRoleIds: audienceScope === "all" ? [] : current.audienceRoleIds,
            }));
          }}
        >
          {(["all", "roles"] as const).map((audienceScope) => (
            <Label key={audienceScope} className="important-notices-admin__audience-option">
              <RadioGroupItem value={audienceScope} disabled={!editable} />
              <span>
                <strong>{t(`importantNotices.audience.${audienceScope}`)}</strong>
                <small>{t(`importantNotices.audience.${audienceScope}Description`)}</small>
              </span>
            </Label>
          ))}
        </RadioGroup>
        {draft.audienceScope === "roles" ? (
          audienceRolesQuery.isLoading ? (
            <LoadingIndicator />
          ) : audienceRolesQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>{t("importantNotices.audience.loadError")}</AlertTitle>
              <AlertDescription>
                <Button size="xs" variant="outline" onClick={() => void audienceRolesQuery.refetch()}>
                  {common("action.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <PickList
                className="important-notices-admin__role-picker"
                aria-label={t("importantNotices.field.roles")}
                options={audienceRoleOptions}
                selected={selectedAudienceRoleIds}
                onToggle={toggleAudienceRole}
                emptyLabel={t("importantNotices.audience.noRoles")}
                size="xs"
              />
              {!hasValidAudience ? (
                <span className="important-notices-admin__validation" role="alert">
                  {t("importantNotices.validation.audience")}
                </span>
              ) : null}
            </>
          )
        ) : null}
      </section>

      <div className="important-notices-admin__acknowledgement-card">
        <span className="important-notices-admin__delivery-heading">
          <strong>{t("importantNotices.field.forceAcknowledgement")}</strong>
          <small id={acknowledgementDescriptionId}>
            {t("importantNotices.field.forceAcknowledgementDescription")}
          </small>
        </span>
        <Switch
          checked={draft.requiresAcknowledgement}
          disabled={!editable}
          aria-label={t("importantNotices.field.forceAcknowledgement")}
          aria-describedby={acknowledgementDescriptionId}
          onCheckedChange={(requiresAcknowledgement) => {
            setDraft((current) => ({ ...current, requiresAcknowledgement }));
          }}
        />
      </div>
      <NativeDateTimeInput
        type="datetime-local"
        label={t("importantNotices.field.publishAt")}
        description={t("importantNotices.field.publishAtDescription")}
        value={draft.publishAt}
        disabled={!editable}
        onChange={(event) => {
          const publishAt = event.currentTarget.value;
          setDraft((current) => ({ ...current, publishAt }));
        }}
      />
      <NativeDateTimeInput
        type="datetime-local"
        label={t("importantNotices.field.expiresAt")}
        description={t("importantNotices.field.expiresAtDescription")}
        value={draft.expiresAt}
        disabled={!editable}
        error={expiryError}
        onChange={(event) => {
          const expiresAt = event.currentTarget.value;
          setDraft((current) => ({ ...current, expiresAt }));
        }}
      />
    </div>
  );
}
