import {
  Badge,
  Button,
  Modal,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
} from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { fetchUsersList } from "../../../api/queries/users";

type AdminUserRow = Awaited<ReturnType<typeof fetchUsersList>>["data"][number];

type AdminMemberDetailModalProps = {
  open: boolean;
  member: AdminUserRow | null;
  memberDetailTitle: string;
  memberDetailBio: string;
  onClose: () => void;
  onMemberDetailTitleChange: (value: string) => void;
  onMemberDetailBioChange: (value: string) => void;
  onSaveProfile: (member: AdminUserRow) => void;
  saveProfilePending: boolean;
  mediaTab: ReactNode;
};

function detailItem(label: string, value: ReactNode) {
  return (
    <Stack gap={2}>
      <Text c="dimmed" size="xs">{label}</Text>
      <Text size="sm">{value}</Text>
    </Stack>
  );
}

export function AdminMemberDetailModal({
  open,
  member,
  memberDetailTitle,
  memberDetailBio,
  onClose,
  onMemberDetailTitleChange,
  onMemberDetailBioChange,
  onSaveProfile,
  saveProfilePending,
  mediaTab,
}: AdminMemberDetailModalProps) {
  const { t } = useTranslation("admin");
  return (
    <Modal
      opened={open}
      title={member ? t("detail.titleWithName", { username: member.user.username }) : t("detail.title")}
      onClose={onClose}
      size="80%"
      centered
    >
      {member ? (
        <Tabs defaultValue="overview">
          <Tabs.List>
            <Tabs.Tab value="overview">{t("detail.tab.overview")}</Tabs.Tab>
            <Tabs.Tab value="profile">{t("detail.tab.profile")}</Tabs.Tab>
            <Tabs.Tab value="media">{t("detail.tab.media")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" pt="sm">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
              {detailItem(t("detail.field.username"), member.user.username)}
              {detailItem(t("detail.field.wechat"), member.profile.wechat_name ?? "-")}
              {detailItem(t("detail.field.role"), member.user.role)}
              {detailItem(t("detail.field.status"), member.user.is_active ? <Badge color="infini-success" variant="light">{t("member.status.active")}</Badge> : <Badge variant="light">{t("member.status.inactive")}</Badge>)}
              {detailItem(t("detail.field.power"), member.profile.power)}
              {detailItem(t("detail.field.classes"), member.profile.classes.join(", ") || "-")}
              {detailItem(t("detail.field.vacation"), `${member.profile.vacation_start ?? "-"} ~ ${member.profile.vacation_end ?? "-"}`)}
              {detailItem(t("detail.field.discordId"), member.profile.discord_id ?? "-")}
              {detailItem(t("detail.field.notes"), member.profile.notes ?? "-")}
            </SimpleGrid>
          </Tabs.Panel>

          <Tabs.Panel value="profile" pt="sm">
            <Stack gap={12}>
              <Textarea
                minRows={3}
                value={memberDetailTitle}
                onChange={(event) => onMemberDetailTitleChange(event.currentTarget.value)}
                label={t("detail.field.titleHtml")}
                placeholder={t("detail.placeholder.titleHtml")}
                aria-label="Member title HTML"
              />
              <Textarea
                minRows={4}
                value={memberDetailBio}
                onChange={(event) => onMemberDetailBioChange(event.currentTarget.value)}
                label={t("detail.field.bio")}
                placeholder={t("detail.placeholder.bio")}
                aria-label="Member bio"
              />
              <Button onClick={() => onSaveProfile(member)} loading={saveProfilePending}>
                {t("detail.saveProfile")}
              </Button>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="media" pt="sm">
            {mediaTab}
          </Tabs.Panel>
        </Tabs>
      ) : null}
    </Modal>
  );
}
