import type { DragEndEvent } from "@dnd-kit/core";
import { SectionHeader } from "../../shared/SectionHeader";
import { NumberInput, Paper, Textarea } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { TitleField } from "../../shared/TitleField";
import { ProfileClassEditor } from "./ProfileClassEditor";

type ProfileProfileTabProps = {
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
      </div>
    </Paper>
  );
}
