import { Modal, Stack, Text } from "@mantine/core";

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
  return (
    <Modal
      opened={open}
      title={activeDetailUserId ? `Member: ${activeDetailUserId}` : "Member detail"}
      onClose={onClose}
      withCloseButton
    >
      {activeDetail ? (
        <Stack gap={8}>
          <Text>
            Team: <strong>{activeDetail.teamName}</strong>
          </Text>
          <Text>Role tag: {activeDetail.roleTag ?? "-"}</Text>
          <Text>
            K/D/A: {activeDetail.kills}/{activeDetail.deaths}/{activeDetail.assists}
          </Text>
          <Text>Damage: {activeDetail.damage}</Text>
          <Text>Healing: {activeDetail.healing}</Text>
          <Text>Building: {activeDetail.buildingDamage}</Text>
          <Text>Credits: {activeDetail.credits}</Text>
        </Stack>
      ) : null}
    </Modal>
  );
}