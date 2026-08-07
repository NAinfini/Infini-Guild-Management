import { ActionIcon, Text, TextInput, Tooltip } from "@mantine/core";
import { PaletteIcon, TrashIcon } from "@portal/components/icons";
import { sanitizeTitleHtml } from "@portal/utils/sanitize";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LabelStyleModal } from "./LabelStyleModal";
import "./TitleField.css";

type TitleFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** 只读时整栏冻结：预览照常显示，样式器和清空都点不动。 */
  disabled?: boolean;
};

/**
 * 称号编辑栏：资料页和后台成员详情共用这一份。
 *
 * 同一个字段在两处长成两个控件，就会出现「后台贴 HTML、资料页用样式器」
 * 这种两套心智模型；文案也走 profile 这一个命名空间，不在 admin 里另存一份。
 */
export function TitleField({ value, onChange, disabled = false }: TitleFieldProps) {
  const { t } = useTranslation("profile");
  const [editorOpen, setEditorOpen] = useState(false);

  // sanitizeTitleHtml is MemberCard's sanitizer: the preview here and the card
  // in the rail must not disagree about what survives.
  const safeTitleHtml = useMemo(
    () => (value ? sanitizeTitleHtml(value) : ""),
    [value],
  );

  /*
   * 「有没有标签」决定这一栏是输入框还是预览框。大多数人的称号就是几个字，
   * 那种情况下逼他们去开一个样式器再回来才能改一个错别字，是把工具当门槛。
   */
  const isStyled = /<[a-z][\s\S]*>/i.test(value);

  return (
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
            value={value}
            placeholder={t("field.titleEmpty")}
            aria-label={t("field.title")}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        )}
        <Tooltip label={value ? t("action.editTitle") : t("action.createTitle")} withArrow>
          <ActionIcon
            variant="default"
            size={36}
            aria-label={value ? t("action.editTitle") : t("action.createTitle")}
            disabled={disabled}
            onClick={() => setEditorOpen(true)}
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
              disabled={disabled}
              onClick={() => onChange("")}
            >
              <TrashIcon size={16} />
            </ActionIcon>
          </Tooltip>
        ) : null}
      </div>

      {/* Mounted only while open: the editor seeds itself from initialHtml
          as initial state, so a permanently mounted copy would go stale.
          称号只存 HTML，编辑器附带回来的色号在这里没有落点（徽章才单独存一份）。 */}
      {editorOpen ? (
        <LabelStyleModal
          opened
          onClose={() => setEditorOpen(false)}
          initialHtml={value}
          onApply={({ html }) => onChange(html)}
        />
      ) : null}
    </div>
  );
}
