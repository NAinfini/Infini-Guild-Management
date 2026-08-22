import type { DragEndEvent } from "@dnd-kit/core";
import type { UserBadge } from "@guild/shared";
import { SectionHeader } from "../../shared/SectionHeader";
import { Badge, NumberInput, Paper, Text, Textarea } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { MemberBadgeChip } from "../../shared/MemberCard";
import { TitleField } from "../../shared/TitleField";
import { ProfileClassEditor } from "./ProfileClassEditor";

type ProfileProfileTabProps = {
  roleName: string | null;
  roleColor: string | null;
  badges: readonly UserBadge[];
  power: number;
  classDraft: string;
  classOptions: Array<{ value: string; label: string }>;
  classList: string[];
  titleHtml: string;
  onTitleHtmlChange: (value: string) => void;
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
  power,
  classDraft,
  classOptions,
  classList,
  titleHtml,
  onTitleHtmlChange,
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
    <Paper withBorder radius="md" p="var(--card-padding)">
      <SectionHeader title={t("section.identity")} />

      <div className="profile-identity">
        <NumberInput
          label={t("field.power")}
          value={power}
          decimalScale={2}
          hideControls
          onChange={(value) => { if (typeof value === "number") onPowerChange(value); }}
        />

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

        <Textarea
          className="profile-identity__wide"
          label={t("field.bio")}
          value={bio}
          onChange={(event) => onBioChange(event.currentTarget.value)}
          minRows={3}
          autosize
          maxRows={10}
          placeholder={t("field.bioPlaceholder")}
        />

        <section className="profile-access profile-identity__wide" aria-label={t("section.access")}>
          <div className="profile-access__header">
            <h3 className="profile-access__title">{t("section.access")}</h3>
            <Text size="xs" c="dimmed">{t("access.readOnly")}</Text>
          </div>

          <div className="profile-access__group">
            <div className="profile-access__group-heading">
              <h4>{t("access.role")}</h4>
            </div>
            {roleName ? (
              <Badge
                className="profile-access__role"
                color={roleColor ?? "gray"}
                size="lg"
                variant="light"
              >
                {roleName}
              </Badge>
            ) : (
              <Text size="sm" c="dimmed">{t("access.emptyRole")}</Text>
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
              <Text size="sm" c="dimmed">{t("access.emptyBadges")}</Text>
            )}
          </div>

        </section>
      </div>
    </Paper>
  );
}
