import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PortalCard } from "../../shared/PortalCard";
import { FloatingSaveBar } from "../../shared/FloatingSaveBar";
import { Button, Divider, Group, NumberInput, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { ExternalLinkIcon, PlusIcon } from "@portal/components/icons";
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
    <>
      <PortalCard interactive={false}>
        <Stack gap={0} p="1.2rem">
          {/* ── Basic Info ── */}
          <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5} mb={10}>{t("section.basicInfo")}</Text>
          <NumberInput
            label={t("field.power")}
            value={power}
            decimalScale={2}
            hideControls
            onChange={(value) => { if (typeof value === "number") onPowerChange(value); }}
          />

          <Divider my={16} />

          {/* ── Classes ── */}
          <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5} mb={10}>{t("section.classes")}</Text>
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
            <Button onClick={onAddClass} leftSection={<PlusIcon size={16} />}>{t("action.add")}</Button>
          </Group>
          {classList.length > 0 && (
            <DndContext sensors={classSensors} collisionDetection={closestCenter} onDragEnd={onClassDragEnd}>
              <SortableContext items={classList} strategy={verticalListSortingStrategy}>
                <Stack gap={6} mt={8}>{classList.map((item, index) => renderSortableClassRow(item, index))}</Stack>
              </SortableContext>
            </DndContext>
          )}

          <Divider my={16} />

          {/* ── About ── */}
          <Text fw={700} size="sm" c="dimmed" tt="uppercase" lts={0.5} mb={10}>{t("section.about")}</Text>
          <TextInput
            label={
              <Group gap={8} align="center" wrap="nowrap" style={{ lineHeight: 1.4 }}>
                <span>{t("field.titleHtml")}</span>
                <Text component={Link} to="/tools" size="xs" c="dimmed" td="underline" style={{ cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 2 }}>
                  {t("action.titleGenerator")}<ExternalLinkIcon size={12} />
                </Text>
              </Group>
            }
            value={titleHtml}
            onChange={(event) => onTitleHtmlChange(event.currentTarget.value)}
            placeholder={t("field.titleHtml")}
          />
          {titleHtml ? (
            <div style={{ marginTop: 6 }}>
              <Text c="dimmed" size="xs" mb={4}>{t("field.titlePreview")}</Text>
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(titleHtml) }} />
            </div>
          ) : null}
          <Textarea
            label={t("field.bio")}
            value={bio}
            onChange={(event) => onBioChange(event.currentTarget.value)}
            minRows={3}
            autosize
            maxRows={8}
            placeholder={fieldBioPlaceholder}
            mt={12}
          />
        </Stack>
      </PortalCard>
      <FloatingSaveBar isDirty={isDirty} saving={savePending} onSave={onSaveProfile} />
    </>
  );
}
