import type { DragEndEvent } from "@dnd-kit/core";
import type { UserBadge } from "@guild/shared";
import { SectionHeader } from "../../shared/SectionHeader";
import { Badge } from "@portal/components/ui/badge";
import { Card } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Textarea } from "@portal/components/ui/textarea";
import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import { MemberBadgeChip } from "../../shared/MemberCard";
import { TitleField } from "../../shared/TitleField";
import { ProfileClassEditor } from "./ProfileClassEditor";

type ProfileProfileTabProps = {
  roleName: string | null;
  roleColor: string | null;
  badges: readonly UserBadge[];
  displayName: string;
  power: number;
  classDraft: string;
  classOptions: Array<{ value: string; label: string }>;
  classList: string[];
  titleHtml: string;
  onTitleHtmlChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  bio: string;
  onPowerChange: (value: number) => void;
  onClassDraftChange: (value: string) => void;
  onAddClass: (value: string) => void;
  onClassDragEnd: (event: DragEndEvent) => void;
  onRemoveClass: (index: number) => void;
  onBioChange: (value: string) => void;
};

/** Identity fields; title editing shares the validated title-sandbox contract. */
export function ProfileProfileTab({
  roleName,
  roleColor,
  badges,
  displayName,
  power,
  classDraft,
  classOptions,
  classList,
  titleHtml,
  onTitleHtmlChange,
  onDisplayNameChange,
  bio,
  onPowerChange,
  onClassDraftChange,
  onAddClass,
  onClassDragEnd,
  onRemoveClass,
  onBioChange,
}: ProfileProfileTabProps) {
  const { t } = useTranslation("profile");

  return (
    <Card className="profile-identity-card gap-0 py-0">
      <SectionHeader title={t("section.identity")} />

      <div className="profile-identity">
        <div className="profile-field profile-identity__wide">
          <Label htmlFor="profile-display-name">{t("field.displayName")}</Label>
          <Input
            id="profile-display-name"
            value={displayName}
            onChange={(event) => onDisplayNameChange(event.currentTarget.value)}
            autoComplete="nickname"
          />
        </div>

        <div className="profile-field">
          <Label htmlFor="profile-power">{t("field.power")}</Label>
          <Input
            id="profile-power"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={power}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isFinite(next)) onPowerChange(next);
            }}
          />
        </div>

        <TitleField value={titleHtml} onChange={onTitleHtmlChange} />

        <div className="profile-identity__wide">
          <ProfileClassEditor
            classDraft={classDraft}
            classOptions={classOptions}
            classList={classList}
            onClassDraftChange={onClassDraftChange}
            onAddClass={onAddClass}
            onClassDragEnd={onClassDragEnd}
            onRemoveClass={onRemoveClass}
          />
        </div>

        <div className="profile-field profile-identity__wide">
          <Label htmlFor="profile-bio">{t("field.bio")}</Label>
          <Textarea
            id="profile-bio"
            value={bio}
            onChange={(event) => onBioChange(event.currentTarget.value)}
            rows={4}
            placeholder={t("field.bioPlaceholder")}
          />
        </div>

        <div className="profile-access profile-identity__wide" role="region" aria-label={t("section.access")}>
          <div className="profile-access__header">
            <h3 className="profile-access__title">{t("section.access")}</h3>
            <span className="profile-access__hint">{t("access.readOnly")}</span>
          </div>

          <div className="profile-access__group">
            <div className="profile-access__group-heading">
              <h4>{t("access.role")}</h4>
            </div>
            {roleName ? (
              <Badge
                className="profile-access__role"
                variant="outline"
                style={{ "--badge-color": roleColor ?? "var(--text-muted)" } as CSSProperties}
              >
                {roleName}
              </Badge>
            ) : (
              <span className="profile-access__empty">{t("access.emptyRole")}</span>
            )}
          </div>

          <div className="profile-access__group">
            <div className="profile-access__group-heading">
              <h4>{t("access.badges")}</h4>
            </div>
            {badges.length > 0 ? (
              <ul className="profile-access__badges">
                {badges.map((badge) => (
                  <li key={badge.id}><MemberBadgeChip badge={badge} /></li>
                ))}
              </ul>
            ) : (
              <span className="profile-access__empty">{t("access.emptyBadges")}</span>
            )}
          </div>

        </div>
      </div>
    </Card>
  );
}
