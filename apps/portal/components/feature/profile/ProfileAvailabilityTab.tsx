import { Card } from "@portal/components/ui/card";
import { useTranslation } from "react-i18next";
import { AvailabilityEditor } from "@portal/components/shared/AvailabilityEditor";
import { AbsenceManagerCard } from "@portal/components/shared/AbsenceManagerCard";
import { SectionHeader } from "@portal/components/shared/SectionHeader";
import type { MemberAvailability } from "@guild/shared";

type ProfileAvailabilityTabProps = {
  userId: string | undefined;
  availabilityData: MemberAvailability | null;
  onAvailabilityChange: (value: MemberAvailability | null) => void;
};

export function ProfileAvailabilityTab({
  userId,
  availabilityData,
  onAvailabilityChange,
}: ProfileAvailabilityTabProps) {
  const { t } = useTranslation("profile");
  return (
    <div className="profile-availability-stack">
      <Card className="profile-availability-card gap-0 py-0">
        <SectionHeader title={t("availability.section.week")} />
        <AvailabilityEditor
          value={availabilityData}
          onChange={({ availability }) => {
            onAvailabilityChange(availability);
          }}
        />
      </Card>
      <AbsenceManagerCard userId={userId} />
    </div>
  );
}
