import { Badge, Group, Modal, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BoltIcon } from "@portal/components/icons";
import { sanitizeTitleHtml } from "../../../utils/sanitize";

type ActiveMemberDetail = {
  username: string;
  power: number;
  classes: string[];
  titleHtml: string | null;
  teamName: string;
  roleTag: string | null;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  healing: number;
  buildingDamage: number;
  credits: number;
};

type WarMemberDetailModalProps = {
  open: boolean;
  activeDetailUserId: string | null;
  activeDetail: ActiveMemberDetail | null;
  onClose: () => void;
};

export function WarMemberDetailModal({
  open,
  activeDetailUserId,
  activeDetail,
  onClose,
}: WarMemberDetailModalProps) {
  const { t } = useTranslation("guild-war");
  const safeTitleHtml = useMemo(
    () => (activeDetail?.titleHtml ? sanitizeTitleHtml(activeDetail.titleHtml) : ""),
    [activeDetail?.titleHtml],
  );
  return (
    <Modal
      opened={open}
      title={activeDetail?.username ?? activeDetailUserId ?? ""}
      onClose={onClose}
      withCloseButton
      centered
    >
      {activeDetail ? (
        <Stack gap={12}>
          {safeTitleHtml ? (
            <Text size="sm" c="dimmed" dangerouslySetInnerHTML={{ __html: safeTitleHtml }} />
          ) : null}

          <Group gap={8} wrap="wrap">
            {activeDetail.classes.map((cls) => (
              <Badge key={cls} variant="light" size="sm">{cls}</Badge>
            ))}
          </Group>

          <Group gap={12}>
            <Text size="sm" fw={500}>
              <BoltIcon size={14} style={{ display: "inline-block", verticalAlign: "-2px" }} />{" "}
              {activeDetail.power.toLocaleString()}
            </Text>
          </Group>

          <Text size="sm">
            {t("memberDetail.team")}: <strong>{activeDetail.teamName}</strong>
          </Text>
          {activeDetail.roleTag ? (
            <Text size="sm">{t("memberDetail.roleTag")}: {activeDetail.roleTag}</Text>
          ) : null}

          <Text size="xs" fw={600} c="dimmed" mt={4}>{t("memberDetail.statsHeader")}</Text>
          <Group gap={16} wrap="wrap">
            <Text size="sm">{t("memberDetail.kda")}: {activeDetail.kills}/{activeDetail.deaths}/{activeDetail.assists}</Text>
            <Text size="sm">{t("memberDetail.damage")}: {activeDetail.damage.toLocaleString()}</Text>
            <Text size="sm">{t("memberDetail.healing")}: {activeDetail.healing.toLocaleString()}</Text>
            <Text size="sm">{t("memberDetail.building")}: {activeDetail.buildingDamage.toLocaleString()}</Text>
            <Text size="sm">{t("memberDetail.credits")}: {activeDetail.credits.toLocaleString()}</Text>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  );
}
