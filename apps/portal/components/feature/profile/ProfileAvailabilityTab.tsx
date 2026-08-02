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
      {/* 网格和请假原先是两块裸控件直接贴在标签页上，和主页屏那两张带边框、
          带章节标题的卡不是同一种东西。这一屏也是「一屏一叠卡」。 */}
      <Paper withBorder radius="md" p="var(--card-padding)">
        {/* 标题只给「一周在线时间」。时区说明和清空按钮是编辑器自带的一行，
            再往标题右边抄一份就是同一句话说两遍。 */}
        <SectionHeader title={t("availability.section.week")} />
        {/* 文案原先由这里逐条透传给编辑器。编辑器自己就在 profile 命名空间下取词，
            中间这层 labels 只是把同一批 key 抄了两遍。 */}
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
