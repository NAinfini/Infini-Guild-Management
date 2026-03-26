import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PortalCard } from "../../shared/PortalCard";
import { Badge, Button, Group, NumberInput, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { IconExternalLink, IconPlus, IconDeviceFloppy } from "@tabler/icons-react";
import type { ReactNode } from "react";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

type ProfileProfileTabProps = {
  wechatName: string;
  power: number;
  classDraft: string;
  classOptions: Array<{ value: string; label: string }>;
  classList: string[];
  titleHtml: string;
  onTitleHtmlChange: (value: string) => void;
  bio: string;
  discordId: string | null;
  classSensors: ReturnType<typeof import("@dnd-kit/core").useSensors>;
  onWechatNameChange: (value: string) => void;
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
  wechatName,
  power,
  classDraft,
  classOptions,
  classList,
  titleHtml,
  onTitleHtmlChange,
  bio,
  discordId,
  classSensors,
  onWechatNameChange,
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
        <Group justify="flex-end" gap={8} p="1.2rem">
          <Badge color={isDirty ? "infini-warning" : "infini-success"}>
            {isDirty ? t("status.unsavedChanges") : t("status.saved")}
          </Badge>
          <Button onClick={onSaveProfile} loading={savePending} leftSection={<IconDeviceFloppy size={16} />}>
            {t("action.saveProfile")}
          </Button>
        </Group>
      </PortalCard>

      <PortalCard interactive={false}>
        <Stack gap={14} p="1.2rem">
          <Text fw={700} size="md">{t("section.basicInfo")}</Text>

          <TextInput
            label={t("field.wechat")}
            value={wechatName}
            onChange={(event) => onWechatNameChange(event.currentTarget.value)}
            placeholder={t("field.wechatPlaceholder")}
          />
          <NumberInput
            label={t("field.power")}
            value={power}
            onChange={(value) => onPowerChange(typeof value === "number" ? value : 0)}
          />
          <TextInput
            label={t("field.discordId")}
            value={discordId ?? "-"}
            readOnly
            variant="filled"
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
              aria-label="Select class"
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
              <Group gap={8} align="center">
                <span>{t("field.titleHtml")}</span>
                <Text component={Link} to="/tools" size="xs" c="dimmed" td="underline" style={{ cursor: "pointer" }}>
                  {t("action.titleGenerator")} <IconExternalLink size={12} style={{ verticalAlign: "middle" }} />
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
    </Stack>
  );
}
