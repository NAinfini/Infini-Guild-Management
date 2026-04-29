import { PortalCard } from "../../shared/PortalCard";
import { Badge, Button, Group, Stack } from "@mantine/core";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { AvailabilityGridEditor } from "@portal/components/shared/AvailabilityGridEditor";

type ProfileAvailabilityTabProps = {
  availabilityData: Record<string, unknown> | null;
  vacationStart: string;
  vacationEnd: string;
  onAvailabilityChange: (value: Record<string, unknown>) => void;
  onVacationStartChange: (value: string) => void;
  onVacationEndChange: (value: string) => void;
  onSaveAvailability: () => void;
  savePending: boolean;
  isDirty: boolean;
};

export function ProfileAvailabilityTab({
  availabilityData,
  vacationStart,
  vacationEnd,
  onAvailabilityChange,
  onVacationStartChange,
  onVacationEndChange,
  onSaveAvailability,
  savePending,
  isDirty,
}: ProfileAvailabilityTabProps) {
  const { t } = useTranslation("profile");
  return (
    <Stack gap={16}>
      <PortalCard interactive={false}>
        <Group justify="flex-end" gap={8} p="1.2rem">
          <Badge color={isDirty ? "yellow" : "green"}>
            {isDirty ? t("status.unsavedChanges") : t("status.saved")}
          </Badge>
          <Button onClick={onSaveAvailability} loading={savePending} leftSection={<IconDeviceFloppy size={16} />}>
            {t("action.saveProfile")}
          </Button>
        </Group>
      </PortalCard>
      <AvailabilityGridEditor
        value={availabilityData}
        vacationStart={vacationStart}
        vacationEnd={vacationEnd}
        labels={{
          timezoneNote: t("availability.editor.timezoneNote"),
          clearAll: t("availability.editor.clearAll"),
          gridHint: t("availability.editor.gridHint"),
          vacation: t("availability.editor.vacation"),
          startDate: t("availability.editor.startDate"),
          endDate: t("availability.editor.endDate"),
          dayMon: t("availability.editor.dayMon"),
          dayTue: t("availability.editor.dayTue"),
          dayWed: t("availability.editor.dayWed"),
          dayThu: t("availability.editor.dayThu"),
          dayFri: t("availability.editor.dayFri"),
          daySat: t("availability.editor.daySat"),
          daySun: t("availability.editor.daySun"),
        }}
        onChange={({ availability, vacationStart: nextVacationStart, vacationEnd: nextVacationEnd }) => {
          onAvailabilityChange((availability ?? null) as Record<string, unknown>);
          onVacationStartChange(nextVacationStart);
          onVacationEndChange(nextVacationEnd);
        }}
      />
    </Stack>
  );
}
