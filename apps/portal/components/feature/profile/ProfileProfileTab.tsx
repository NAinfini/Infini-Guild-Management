import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PortalCard } from "../../shared/PortalCard";
import { FloatingSaveBar } from "../../shared/FloatingSaveBar";
import { Button, Group, NumberInput, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { IconExternalLink, IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

type ProfileProfileTabProps = {
  power: number;
  classDraft: string;
  classOptions: Array<{ value: string; label: string }>;
  classList: string[];
  titleHtml: string;
  onTitleHtmlChange: (value: string) => void;
  bio: string;
  classSensors: ReturnType<typeof import("@dnd-kit/core").useSensors>;
  onPowerChange: (value: number) => void;
  onClassDraftChange: (value: string) => void;
  onAddClass: () => void;
  onClassDragEnd: (event: DragEndEvent) => void;
  renderSortableClassRow: (value: string, index: number) => ReactNode;
  onBioChange: (value: string) => void;
  onSaveProfile: () => void;
  savePending: boolean;
  isDirty: boolean;
  fieldBioPlaceholder: string;
};

export function ProfileProfileTab({
  power,
  classDraft,
  classOptions,
  classList,
  titleHtml,
  onTitleHtmlChange,
  bio,
  classSensors,
  onPowerChange,
  onClassDraftChange,
  onAddClass,
  onClassDragEnd,
  renderSortableClassRow,
  onBioChange,
  onSaveProfile,
  savePending,
  isDirty,
  fieldBioPlaceholder,
}: ProfileProfileTabProps) {
  const { t } = useTranslation("profile");
  return (
    <Stack gap={16}>
      <PortalCard interactive={false}>
        <Stack gap={14} p="1.2rem">
          <Text fw={700} size="md">{t("section.basicInfo")}</Text>

          <NumberInput
            label={t("field.power")}
            value={power}
            decimalScale={2}
            onChange={(value) => onPowerChange(typeof value === "number" ? value : 0)}
          />
        </Stack>
      </PortalCard>

      <PortalCard interactive={false}>
        <Stack gap={12} p="1.2rem">
          <Text fw={700} size="md">{t("section.classes")}</Text>
          <Group gap={8} wrap="nowrap">
            <Select
              searchable
              value={classDraft || null}
              data={classOptions}
              style={{ flex: 1 }}
              placeholder={t("field.selectClass")}
              aria-label={t("aria.selectClass")}
              onChange={(value) => onClassDraftChange(value ?? "")}
              onSearchChange={(value) => onClassDraftChange(value)}
            />
            <Button onClick={onAddClass} leftSection={<IconPlus size={16} />}>{t("action.add")}</Button>
          </Group>
          <DndContext sensors={classSensors} collisionDetection={closestCenter} onDragEnd={onClassDragEnd}>
            <SortableContext items={classList} strategy={verticalListSortingStrategy}>
              <Stack gap={6}>{classList.map((item, index) => renderSortableClassRow(item, index))}</Stack>
            </SortableContext>
          </DndContext>
        </Stack>
      </PortalCard>

      <PortalCard interactive={false}>
        <Stack gap={12} p="1.2rem">
          <Text fw={700} size="md">{t("section.about")}</Text>
          <TextInput
            label={
              <Group gap={8} align="center" wrap="nowrap" style={{ lineHeight: 1.4 }}>
                <span>{t("field.titleHtml")}</span>
                <Text component={Link} to="/tools" size="xs" c="dimmed" td="underline" style={{ cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 2 }}>
                  {t("action.titleGenerator")}<IconExternalLink size={12} />
                </Text>
              </Group>
            }
            value={titleHtml}
            onChange={(event) => onTitleHtmlChange(event.currentTarget.value)}
            placeholder={t("field.titleHtml")}
          />
          {titleHtml ? (
            <div>
              <Text c="dimmed" size="xs" mb={4}>{t("field.titlePreview")}</Text>
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(titleHtml) }} />
            </div>
          ) : null}
          <Textarea
            label={t("field.bio")}
            value={bio}
            onChange={(event) => onBioChange(event.currentTarget.value)}
            minRows={4}
            placeholder={fieldBioPlaceholder}
          />
        </Stack>
      </PortalCard>
      <FloatingSaveBar isDirty={isDirty} saving={savePending} onSave={onSaveProfile} />
    </Stack>
  );
}
