import { ActionIcon, Badge, Button, Card, Group, Skeleton, Stack, Text, TextInput } from "@mantine/core";
import { LIMITS } from "@guild/shared/config/limits";
import { TrashIcon } from "@portal/components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMemberAbsences } from "../../hooks/useMemberAbsences";
import { localDateKey } from "../../utils/datetime";
import { NativeDateTimeInput } from "./NativeDateTimeInput";

type AbsenceManagerCardProps = {
  userId: string | undefined;
};

export function AbsenceManagerCard({ userId }: AbsenceManagerCardProps) {
  const { t } = useTranslation("profile");
  const { absencesQuery, createMutation, deleteMutation } = useMemberAbsences(userId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");

  const absences = absencesQuery.data?.data ?? [];
  const canSubmit = Boolean(startDate && endDate && startDate <= endDate);

  const handleAdd = () => {
    if (!canSubmit) return;
    createMutation.mutate(
      { start_date: startDate, end_date: endDate, note: note.trim() ? note.trim() : null },
      {
        onSuccess: () => {
          setStartDate("");
          setEndDate("");
          setNote("");
        },
      },
    );
  };

  /* 请假起止是日历日期，要和阅读者日历上的今天比，不是和 UTC 的今天比。 */
  const today = localDateKey();
  const statusOf = (start: string, end: string): { key: string; color: string } => {
    if (end < today) return { key: "absence.status.past", color: "gray" };
    if (start > today) return { key: "absence.status.upcoming", color: "blue" };
    return { key: "absence.status.active", color: "orange" };
  };

  return (
    <Card withBorder padding="sm">
      <Text fw={600} mb={8}>{t("absence.title")}</Text>

      {absencesQuery.isLoading ? (
        <Stack gap={6}>
          <Skeleton height={28} />
          <Skeleton height={28} />
        </Stack>
      ) : absences.length === 0 ? (
        <Text c="dimmed" size="sm">{t("absence.empty")}</Text>
      ) : (
        <Stack gap={6}>
          {absences.map((absence) => {
            const status = statusOf(absence.start_date, absence.end_date);
            return (
              <Group key={absence.id} gap={8} justify="space-between" wrap="nowrap">
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge color={status.color} variant="light" style={{ flexShrink: 0 }}>
                    {t(status.key)}
                  </Badge>
                  <Text size="sm" style={{ flexShrink: 0 }}>
                    {absence.start_date} ~ {absence.end_date}
                  </Text>
                  {absence.note ? (
                    <Text size="sm" c="dimmed" truncate>{absence.note}</Text>
                  ) : null}
                </Group>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  loading={deleteMutation.isPending && deleteMutation.variables === absence.id}
                  onClick={() => deleteMutation.mutate(absence.id)}
                  aria-label={t("absence.delete")}
                >
                  <TrashIcon size={14} />
                </ActionIcon>
              </Group>
            );
          })}
        </Stack>
      )}

      <Group wrap="wrap" align="flex-end" mt={12}>
        <Stack gap={4}>
          <Text c="dimmed" size="sm">{t("absence.startDate")}</Text>
          <NativeDateTimeInput
            value={startDate}
            onChange={(event) => setStartDate(event.currentTarget.value)}
          />
        </Stack>
        <Stack gap={4}>
          <Text c="dimmed" size="sm">{t("absence.endDate")}</Text>
          <NativeDateTimeInput
            value={endDate}
            onChange={(event) => setEndDate(event.currentTarget.value)}
          />
        </Stack>
        <Stack gap={4} style={{ flex: 1, minWidth: 160 }}>
          <Text c="dimmed" size="sm">{t("absence.note")}</Text>
          <TextInput
            value={note}
            maxLength={LIMITS.content.absenceNote.max}
            placeholder={t("absence.notePlaceholder")}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </Stack>
        <Button onClick={handleAdd} disabled={!canSubmit} loading={createMutation.isPending}>
          {t("absence.add")}
        </Button>
      </Group>
    </Card>
  );
}
