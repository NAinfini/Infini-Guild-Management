import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Spoiler, Stack, Text } from "@mantine/core";

type ProfilePreviewCardProps = {
  username: string;
  wechatName: string;
  power: number;
  primaryClass: string;
  imageCount: number;
  videoCount: number;
  hasAudio: boolean;
  discordId: string | null;
  activeNowEstimate: string;
  bio: string;
};

export function ProfilePreviewCard({
  username,
  wechatName,
  power,
  primaryClass,
  imageCount,
  videoCount,
  hasAudio,
  discordId,
  activeNowEstimate,
  bio,
}: ProfilePreviewCardProps) {
  return (
    <InfiniCard>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={8}>
          <Text fw={600}>Profile Preview</Text>
          <Text fw={600}>{username || "-"}</Text>
          <Text c="dimmed" size="sm">Wechat: {wechatName || "-"}</Text>
          <Text c="dimmed" size="sm">Power: {power}</Text>
          <Text c="dimmed" size="sm">Primary class: {primaryClass || "-"}</Text>
          <Text c="dimmed" size="sm">Images: {imageCount}</Text>
          <Text c="dimmed" size="sm">Videos: {videoCount}</Text>
          <Text c="dimmed" size="sm">Audio: {hasAudio ? "yes" : "no"}</Text>
          <Text c="dimmed" size="sm">Discord: {discordId ?? "-"}</Text>
          <Text c="dimmed" size="sm">Active estimate: {activeNowEstimate}</Text>
          <Spoiler maxHeight={84} showLabel="Show more" hideLabel="Show less">
            <Text size="sm">{bio || "No bio"}</Text>
          </Spoiler>
        </Stack>
      </div>
    </InfiniCard>
  );
}