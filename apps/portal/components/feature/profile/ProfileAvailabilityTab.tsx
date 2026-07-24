import { FloatingSaveBar } from "../../shared/FloatingSaveBar";
import { Stack } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { AvailabilityGridEditor } from "@portal/components/shared/AvailabilityGridEditor";
import { AbsenceManagerCard } from "@portal/components/shared/AbsenceManagerCard";

type ProfileAvailabilityTabProps = {
  userId: string | undefined;
  availabilityData: Record<string, unknown> | null;
  onAvailabilityChange: (value: Record<string, unknown>) => void;
  onSaveAvailability: () => void;
  savePending: boolean;
  isDirty: boolean;
};

export function ProfileAvailabilityTab({
  userId,
  availabilityData,
  onAvailabilityChange,
  onSaveAvailability,
  savePending,
  isDirty,
}: ProfileAvailabilityTabProps) {
  const { t } = useTranslation("profile");
  return (
    <Stack gap={16}>
      <AvailabilityGridEditor
        value={availabilityData}
        labels={{
          timezoneNote: t("availability.editor.timezoneNote"),
          clearAll: t("availability.editor.clearAll"),
          gridHint: t("availability.editor.gridHint"),
          dayMon: t("availability.editor.dayMon"),
          dayTue: t("availability.editor.dayTue"),
          dayWed: t("availability.editor.dayWed"),
          dayThu: t("availability.editor.dayThu"),
          dayFri: t("availability.editor.dayFri"),
          daySat: t("availability.editor.daySat"),
          daySun: t("availability.editor.daySun"),
        }}
        onChange={({ availability }) => {
          onAvailabilityChange((availability ?? null) as Record<string, unknown>);
        }}
      />
      <AbsenceManagerCard userId={userId} />
      <FloatingSaveBar isDirty={isDirty} saving={savePending} onSave={onSaveAvailability} />
    </Stack>
  );
}
