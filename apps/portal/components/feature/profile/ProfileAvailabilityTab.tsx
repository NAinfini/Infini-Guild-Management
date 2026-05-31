import { FloatingSaveBar } from "../../shared/FloatingSaveBar";
import { Stack } from "@mantine/core";
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
      <FloatingSaveBar isDirty={isDirty} saving={savePending} onSave={onSaveAvailability} />
    </Stack>
  );
}
