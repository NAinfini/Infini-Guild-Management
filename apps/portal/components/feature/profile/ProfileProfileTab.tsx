import type { DragEndEvent } from "@dnd-kit/core";
import { SectionHeader } from "../../shared/SectionHeader";
import { Grid, Group, NumberInput, Paper, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { ExternalLinkIcon } from "@portal/components/icons";
import { useMemo } from "react";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
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
  onAddClass: () => void;
  onClassDragEnd: (event: DragEndEvent) => void;
  onRemoveClass: (index: number) => void;
  onBioChange: (value: string) => void;
};

/**
 * 资料标签页：只剩「基本信息」与「关于」两组文本字段。头像/图片/视频/音频
 * 已迁到 ProfileMediaTab，这里不再需要 height:100% 去和媒体那半栏对齐。
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

  const safeTitleHtml = useMemo(
    () => (titleHtml ? DOMPurify.sanitize(titleHtml) : ""),
    [titleHtml],
  );

  return (
    <Grid gutter="md">
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Paper withBorder radius="md" p="var(--card-padding)">
          <div>
            <SectionHeader title={t("section.basicInfo")} />
          <NumberInput
            label={t("field.power")}
            value={power}
            decimalScale={2}
            hideControls
            onChange={(value) => { if (typeof value === "number") onPowerChange(value); }}
          />

          <Stack gap={0} mt="lg">
            <ProfileClassEditor
              classDraft={classDraft}
              classOptions={classOptions}
              classList={classList}
              onClassDraftChange={onClassDraftChange}
              onAddClass={onAddClass}
              onClassDragEnd={onClassDragEnd}
              onRemoveClass={onRemoveClass}
            />
            </Stack>
          </div>
        </Paper>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 6 }}>
        <Paper withBorder radius="md" p="var(--card-padding)">
          <div>
            <SectionHeader title={t("section.about")} />
          <TextInput
            label={
              <Group gap={8} align="center" wrap="nowrap" className="profile-field-label">
                <span>{t("field.titleHtml")}</span>
                <Text component={Link} to="/tools" size="xs" c="dimmed" td="underline" className="profile-field-label__link">
                  {t("action.titleGenerator")}<ExternalLinkIcon size={12} />
                </Text>
              </Group>
            }
            value={titleHtml}
            onChange={(event) => onTitleHtmlChange(event.currentTarget.value)}
            placeholder={t("field.titleHtml")}
          />
          {/* 预览原先是裸的一个 div，直接落在表单流里，看不出是「渲染结果」
              还是又一个字段。给它一个明确的框。 */}
          {titleHtml ? (
            <div className="profile-title-preview">
              <Text c="dimmed" size="xs" mb={6}>{t("field.titlePreview")}</Text>
              <div dangerouslySetInnerHTML={{ __html: safeTitleHtml }} />
            </div>
          ) : null}
          <Textarea
            label={t("field.bio")}
            value={bio}
            onChange={(event) => onBioChange(event.currentTarget.value)}
            minRows={4}
            autosize
            maxRows={10}
            placeholder={t("field.bio")}
            mt="md"
            />
          </div>
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
