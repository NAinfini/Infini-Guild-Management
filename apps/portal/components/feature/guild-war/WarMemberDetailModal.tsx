import { Modal, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

type ActiveMemberDetail = {
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
  return (
    <Modal
      opened={open}
      title={activeDetailUserId ? t("memberDetail.title", { userId: activeDetailUserId }) : t("memberDetail.titleFallback")}
      onClose={onClose}
      withCloseButton
    >
      {activeDetail ? (
        <Stack gap={8}>
          <Text>
            {t("memberDetail.team")}: <strong>{activeDetail.teamName}</strong>
          </Text>
          <Text>{t("memberDetail.roleTag")}: {activeDetail.roleTag ?? "-"}</Text>
          <Text>
            {t("memberDetail.kda")}: {activeDetail.kills}/{activeDetail.deaths}/{activeDetail.assists}
          </Text>
          <Text>{t("memberDetail.damage")}: {activeDetail.damage}</Text>
          <Text>{t("memberDetail.healing")}: {activeDetail.healing}</Text>
          <Text>{t("memberDetail.building")}: {activeDetail.buildingDamage}</Text>
          <Text>{t("memberDetail.credits")}: {activeDetail.credits}</Text>
        </Stack>
      ) : null}
    </Modal>
  );
}