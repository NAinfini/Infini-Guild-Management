import { MotionButton } from "@infini-dev-kit/frontend/components";
import { Stack } from "@mantine/core";
import { AvailabilityGridEditor } from "../../shared/AvailabilityGridEditor";

type ProfileAvailabilityTabProps = {
  availabilityData: Record<string, unknown> | null;
  vacationStart: string;
  vacationEnd: string;
  onAvailabilityChange: (value: Record<string, unknown>) => void;
  onVacationStartChange: (value: string) => void;
  onVacationEndChange: (value: string) => void;
  onSaveAvailability: () => void;
};

export function ProfileAvailabilityTab({
  availabilityData,
  vacationStart,
  vacationEnd,
  onAvailabilityChange,
  onVacationStartChange,
  onVacationEndChange,
  onSaveAvailability,
}: ProfileAvailabilityTabProps) {
  return (
    <Stack gap={12}>
      <AvailabilityGridEditor
        value={availabilityData}
        vacationStart={vacationStart}
        vacationEnd={vacationEnd}
        onChange={({ availability, vacationStart: nextVacationStart, vacationEnd: nextVacationEnd }) => {
          onAvailabilityChange((availability ?? null) as Record<string, unknown>);
          onVacationStartChange(nextVacationStart);
          onVacationEndChange(nextVacationEnd);
        }}
      />
      <MotionButton type="primary" onClick={onSaveAvailability}>
        Save Availability
      </MotionButton>
    </Stack>
  );
}