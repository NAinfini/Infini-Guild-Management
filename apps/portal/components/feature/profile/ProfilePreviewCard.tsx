import { PortalCard } from "../../shared/PortalCard";
import { Avatar, Badge, Divider, Group, RingProgress, Spoiler, Stack, Text } from "@mantine/core";
import { IconPhoto, IconVideo } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

type ProfilePreviewCardProps = {
  username: string;
  power: number;
  primaryClass: string;
  imageCount: number;
  videoCount: number;
  activeNowEstimate: string;
  bio: string;
};

function MediaStat({ icon, count, label }: { icon: React.ReactNode; count: number; label: string }) {
  return (
    <Stack gap={2} align="center" style={{ flex: 1 }}>
      <Group gap={4} align="center" wrap="nowrap">
        {icon}
        <Text fw={700} size="lg">{count}</Text>
      </Group>
      <Text c="dimmed" size="xs">{label}</Text>
    </Stack>
  );
}

export function ProfilePreviewCard({
  username,
  power,
  primaryClass,
  imageCount,
  videoCount,
  activeNowEstimate,
  bio,
}: ProfilePreviewCardProps) {
  const { t } = useTranslation("profile");
  const isActive = activeNowEstimate === t("availability.activeNow");
  const initials = (username || "?").slice(0, 2).toUpperCase();
  const maxPower = 100_000_000;
  const powerPercent = Math.min((power / maxPower) * 100, 100);

  return (
    <PortalCard interactive={false}>
      <Stack gap={16} p="1.2rem">
        {/* Header: Avatar + name + badges */}
        <Group gap={14} align="center" wrap="nowrap">
          <Avatar
            size={52}
            radius="xl"
            color="blue"
            style={{ flexShrink: 0 }}
          >
            {initials}
          </Avatar>
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Text fw={700} size="lg" truncate="end">{username || "-"}</Text>
            <Group gap={6}>
              <Badge
                size="sm"
                color={isActive ? "green" : "gray"}
                variant={isActive ? "light" : "default"}
              >
                {activeNowEstimate}
              </Badge>
              {primaryClass && primaryClass !== "-" ? (
                <Badge size="sm" variant="light" color="yellow">{primaryClass}</Badge>
              ) : null}
            </Group>
          </Stack>
        </Group>

        <Divider />

        {/* Power ring */}
        <Group justify="center" gap={12}>
          <RingProgress
            size={72}
            thickness={6}
            roundCaps
            sections={[{ value: powerPercent, color: "blue" }]}
            label={
              <Text ta="center" size="xs" fw={700}>
                {power >= 1_000_000 ? `${(power / 1_000_000).toFixed(1)}M` : power >= 1_000 ? `${(power / 1_000).toFixed(0)}K` : String(power)}
              </Text>
            }
          />
          <Stack gap={0}>
            <Text fw={600} size="sm">{t("preview.power")}</Text>
            <Text c="dimmed" size="xs">{power.toLocaleString()}</Text>
          </Stack>
        </Group>

        <Divider />

        {/* Media stats */}
        <Group gap={8} justify="center">
          <MediaStat icon={<IconPhoto size={16} color="var(--color-primary, #3b82f6)" />} count={imageCount} label={t("preview.images")} />
          <MediaStat icon={<IconVideo size={16} color="var(--color-secondary, #8b5cf6)" />} count={videoCount} label={t("preview.videos")} />
        </Group>

        {bio ? (
          <>
            <Divider />
            <Spoiler maxHeight={84} showLabel={t("preview.showMore")} hideLabel={t("preview.showLess")}>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{bio}</Text>
            </Spoiler>
          </>
        ) : null}
      </Stack>
    </PortalCard>
  );
}
