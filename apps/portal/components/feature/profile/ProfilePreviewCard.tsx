import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Badge, Divider, Group, Spoiler, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" gap={4}>
      <Text c="dimmed" size="sm">{label}</Text>
      <Text size="sm" fw={500} ta="right" style={{ maxWidth: "60%", wordBreak: "break-word" }}>
        {value || "-"}
      </Text>
    </Group>
  );
}

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
  const { t } = useTranslation("profile");
  const isActive = activeNowEstimate === t("availability.activeNow");

  return (
    <InfiniCard interactive={false}>
      <Stack gap={12} p="1.2rem">
        <Text fw={700} size="lg">{username || "-"}</Text>

        <Group gap={6}>
          <Badge
            size="sm"
            color={isActive ? "green" : "gray"}
            variant="light"
          >
            {activeNowEstimate}
          </Badge>
          {primaryClass && primaryClass !== "-" ? (
            <Badge size="sm" variant="light" color="yellow">{primaryClass}</Badge>
          ) : null}
        </Group>

        <Divider />

        <Stack gap={6}>
          <InfoRow label={t("preview.wechat")} value={wechatName} />
          <InfoRow label={t("preview.power")} value={String(power)} />
          <InfoRow label={t("preview.discord")} value={discordId ?? "-"} />
        </Stack>

        <Divider />

        <Group gap={12} justify="center">
          <Stack gap={2} align="center">
            <Text fw={700} size="lg">{imageCount}</Text>
            <Text c="dimmed" size="xs">{t("preview.images")}</Text>
          </Stack>
          <Stack gap={2} align="center">
            <Text fw={700} size="lg">{videoCount}</Text>
            <Text c="dimmed" size="xs">{t("preview.videos")}</Text>
          </Stack>
          <Stack gap={2} align="center">
            <Text fw={700} size="lg">{hasAudio ? "1" : "0"}</Text>
            <Text c="dimmed" size="xs">{t("preview.audio")}</Text>
          </Stack>
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
    </InfiniCard>
  );
}
