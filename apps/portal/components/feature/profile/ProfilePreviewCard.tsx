import { PortalCard } from "../../shared/PortalCard";
import { Avatar, Badge, Group, Spoiler, Stack, Text } from "@mantine/core";
import { PhotoIcon, VideoIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { resolveProfileMediaUrl } from "../../../utils/media";
import { resolveClassDisplayColor } from "@guild/shared/constants/classes";

type ProfilePreviewCardProps = {
  username: string;
  avatarKey: string | null;
  power: number;
  primaryClass: string;
  imageCount: number;
  videoCount: number;
  activeNowEstimate: string;
  bio: string;
};

export function ProfilePreviewCard({
  username,
  avatarKey,
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
  const powerLabel = power >= 1_000_000 ? `${(power / 1_000_000).toFixed(1)}M` : power >= 1_000 ? `${(power / 1_000).toFixed(0)}K` : String(power);

  return (
    <PortalCard interactive={false}>
      <Stack gap={0} p="1rem">
        {/* Avatar + name row */}
        <Group gap={12} align="center" wrap="nowrap">
          <Avatar
            size={56}
            radius="xl"
            color="portal-accent"
            src={avatarKey ? resolveProfileMediaUrl(avatarKey) : undefined}
            style={{ flexShrink: 0 }}
            className="profile-preview-avatar"
          >
            {initials}
          </Avatar>
          <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
            <Text fw={700} size="md" truncate="end" lh={1.3}>{username || "-"}</Text>
            <Group gap={4} wrap="wrap">
              <Badge
                size="xs"
                color={isActive ? "green" : "gray"}
                variant={isActive ? "light" : "default"}
              >
                {activeNowEstimate}
              </Badge>
              {primaryClass && primaryClass !== "-" ? (
                <Badge size="xs" variant="light" color={resolveClassDisplayColor(primaryClass)}>
                  {primaryClass}
                </Badge>
              ) : null}
            </Group>
          </Stack>
        </Group>

        {/* Power + media stats row */}
        <Group gap={0} align="center" justify="center" mt={16} mb={bio ? 12 : 0}
          className="profile-preview-stats-row"
        >
          <Stack gap={2} align="center" style={{ flex: 1 }}>
            <Text fw={700} size="sm">{powerLabel}</Text>
            <Text c="dimmed" size="xs" lh={1}>{t("preview.power")}</Text>
          </Stack>
          <div className="profile-preview-divider" />
          <Stack gap={2} align="center" style={{ flex: 1 }}>
            <Group gap={4} align="center" wrap="nowrap">
              <PhotoIcon size={14} className="profile-preview-stat-icon--image" />
              <Text fw={700} size="sm">{imageCount}</Text>
            </Group>
            <Text c="dimmed" size="xs" lh={1}>{t("preview.images")}</Text>
          </Stack>
          <div className="profile-preview-divider" />
          <Stack gap={2} align="center" style={{ flex: 1 }}>
            <Group gap={4} align="center" wrap="nowrap">
              <VideoIcon size={14} className="profile-preview-stat-icon--video" />
              <Text fw={700} size="sm">{videoCount}</Text>
            </Group>
            <Text c="dimmed" size="xs" lh={1}>{t("preview.videos")}</Text>
          </Stack>
        </Group>

        {bio ? (
          <Spoiler maxHeight={72} showLabel={t("preview.showMore")} hideLabel={t("preview.showLess")}
            styles={{ control: { fontSize: 12 } }}
          >
            <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }} lh={1.5}>{bio}</Text>
          </Spoiler>
        ) : null}
      </Stack>
    </PortalCard>
  );
}
