import type { DragEndEvent } from "@dnd-kit/core";
import { SectionHeader } from "../../shared/SectionHeader";
import { ActionIcon, NumberInput, Paper, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { PaletteIcon, TrashIcon } from "@portal/components/icons";
import { sanitizeTitleHtml } from "@portal/utils/sanitize";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TitleSandboxModal } from "./TitleSandboxModal";
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

/**
 * 身份卡：战力、职业、称号、简介。
 *
 * 称号原先是一个裸的 HTML 文本框，要求成员自己去工具页生成、复制、粘贴一段
 * `<span style="…">`，中间任何一步出错都要靠肉眼比对标签。现在这里只显示渲染
 * 结果，编辑走同一个称号沙盒（工具页用的就是它），存下来的仍是同一份 HTML。
 */
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
  const [titleEditorOpen, setTitleEditorOpen] = useState(false);

  // sanitizeTitleHtml is MemberCard's sanitizer: the preview here and the card
  // in the rail must not disagree about what survives.
  const safeTitleHtml = useMemo(
    () => (titleHtml ? sanitizeTitleHtml(titleHtml) : ""),
    [titleHtml],
  );

  /*
   * 「有没有标签」决定这一栏是输入框还是预览框。大多数人的称号就是几个字，
   * 那种情况下逼他们去开一个样式器再回来才能改一个错别字，是把工具当门槛。
   */
  const isStyled = /<[a-z][\s\S]*>/i.test(titleHtml);

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

        <div className="profile-title">
          <Text component="span" size="sm" fw={600} className="profile-title__label">
            {t("field.title")}
          </Text>
          <div className="profile-title__row">
            {isStyled ? (
              /*
               * 带样式的称号只能预览，不能当文本改：输入框里放的会是一串
               * `<span style="…">`，改一个字要在标签之间数位置，而这正是这次要
               * 去掉的东西。清空按钮只在这一支出现——纯文本用退格就能清掉。
               */
              <div className="profile-title__render">
                <div dangerouslySetInnerHTML={{ __html: safeTitleHtml }} />
              </div>
            ) : (
              <TextInput
                className="profile-title__input"
                value={titleHtml}
                placeholder={t("field.titleEmpty")}
                aria-label={t("field.title")}
                onChange={(event) => onTitleHtmlChange(event.currentTarget.value)}
              />
            )}
            <Tooltip label={titleHtml ? t("action.editTitle") : t("action.createTitle")} withArrow>
              <ActionIcon
                variant="default"
                size={36}
                aria-label={titleHtml ? t("action.editTitle") : t("action.createTitle")}
                onClick={() => setTitleEditorOpen(true)}
              >
                <PaletteIcon size={16} />
              </ActionIcon>
            </Tooltip>
            {isStyled ? (
              <Tooltip label={t("action.clearTitle")} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size={36}
                  aria-label={t("action.clearTitle")}
                  onClick={() => onTitleHtmlChange("")}
                >
                  <TrashIcon size={16} />
                </ActionIcon>
              </Tooltip>
            ) : null}
          </div>
        </div>

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

      {/* Mounted only while open: the sandbox seeds its editor from initialHtml
          as initial state, so a permanently mounted copy would go stale. */}
      {titleEditorOpen ? (
        <TitleSandboxModal
          opened
          onClose={() => setTitleEditorOpen(false)}
          initialHtml={titleHtml}
          onApply={onTitleHtmlChange}
        />
      ) : null}
    </Paper>
  );
}
