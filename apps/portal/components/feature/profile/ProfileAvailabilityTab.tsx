import { Paper, Stack } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { AvailabilityEditor } from "@portal/components/shared/AvailabilityEditor";
import { AbsenceManagerCard } from "@portal/components/shared/AbsenceManagerCard";
import { SectionHeader } from "@portal/components/shared/SectionHeader";

type ProfileAvailabilityTabProps = {
  userId: string | undefined;
  availabilityData: Record<string, unknown> | null;
  onAvailabilityChange: (value: Record<string, unknown>) => void;
};

export function ProfileAvailabilityTab({
  userId,
  availabilityData,
  onAvailabilityChange,
}: ProfileAvailabilityTabProps) {
  const { t } = useTranslation("profile");
  return (
    <Stack gap="var(--space-md)">
      <Paper withBorder radius="md" p="var(--card-padding)">
        <SectionHeader title={t("availability.section.week")} />
        <AvailabilityEditor
          value={availabilityData}
          onChange={({ availability }) => {
            onAvailabilityChange((availability ?? null) as Record<string, unknown>);
          }}
        />
      </Paper>
      <AbsenceManagerCard userId={userId} />
    </Stack>
  );
}
