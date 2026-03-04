import { MotionButton } from "@infini-dev-kit/frontend/components";
import {
  Badge,
  Button,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
} from "@mantine/core";
import type { ReactNode } from "react";
import type { fetchUsersList } from "../../../api/queries/users";

type AdminUserRow = Awaited<ReturnType<typeof fetchUsersList>>["data"][number];

type AdminMemberDetailModalProps = {
  open: boolean;
  member: AdminUserRow | null;
  memberDetailTitle: string;
  memberDetailBio: string;
  isAdmin: boolean;
  isModerator: boolean;
  onClose: () => void;
  onMemberDetailTitleChange: (value: string) => void;
  onMemberDetailBioChange: (value: string) => void;
  onSaveProfile: (member: AdminUserRow) => void;
  saveProfilePending: boolean;
  mediaTab: ReactNode;
  onUpdateRole: (member: AdminUserRow, role: "admin" | "moderator" | "member") => void;
  onDeactivate: (member: AdminUserRow) => void;
  onReactivate: (member: AdminUserRow) => void;
  onResetPassword: (member: AdminUserRow) => void;
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
  isAdmin,
  isModerator,
  onClose,
  onMemberDetailTitleChange,
  onMemberDetailBioChange,
  onSaveProfile,
  saveProfilePending,
  mediaTab,
  onUpdateRole,
  onDeactivate,
  onReactivate,
  onResetPassword,
}: AdminMemberDetailModalProps) {
  return (
    <Modal
      opened={open}
      title={member ? `Member Detail · ${member.user.username}` : "Member Detail"}
      onClose={onClose}
      size="80%"
      centered
    >
      {member ? (
        <Tabs defaultValue="overview">
          <Tabs.List>
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab value="profile">Profile</Tabs.Tab>
            <Tabs.Tab value="media">Media</Tabs.Tab>
            <Tabs.Tab value="admin-actions">Admin Actions</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" pt="sm">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
              {detailItem("Username", member.user.username)}
              {detailItem("WeChat", member.profile.wechat_name ?? "-")}
              {detailItem("Role", member.user.role)}
              {detailItem("Status", member.user.is_active ? <Badge color="green" variant="light">active</Badge> : <Badge variant="light">inactive</Badge>)}
              {detailItem("Power", member.profile.power)}
              {detailItem("Classes", member.profile.classes.join(", ") || "-")}
              {detailItem("Vacation", `${member.profile.vacation_start ?? "-"} ~ ${member.profile.vacation_end ?? "-"}`)}
              {detailItem("Discord ID", member.profile.discord_id ?? "-")}
              {detailItem("Notes", member.profile.notes ?? "-")}
            </SimpleGrid>
          </Tabs.Panel>

          <Tabs.Panel value="profile" pt="sm">
            <Stack gap={12}>
              <Textarea
                minRows={3}
                value={memberDetailTitle}
                onChange={(event) => onMemberDetailTitleChange(event.currentTarget.value)}
                placeholder="title_html"
                aria-label="Member title HTML"
              />
              <Textarea
                minRows={4}
                value={memberDetailBio}
                onChange={(event) => onMemberDetailBioChange(event.currentTarget.value)}
                placeholder="bio"
                aria-label="Member bio"
              />
              <Button onClick={() => onSaveProfile(member)} loading={saveProfilePending}>
                Save Profile
              </Button>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="media" pt="sm">
            {mediaTab}
          </Tabs.Panel>

          <Tabs.Panel value="admin-actions" pt="sm">
            <Stack gap={12}>
              {isAdmin ? (
                <Select
                  value={member.user.role}
                  onChange={(value) => value && onUpdateRole(member, value as "admin" | "moderator" | "member")}
                  data={[
                    { value: "member", label: "member" },
                    { value: "moderator", label: "moderator" },
                    { value: "admin", label: "admin" },
                  ]}
                  style={{ width: 180 }}
                />
              ) : (
                <Text c="dimmed" size="sm">Role change requires admin.</Text>
              )}
              <Group wrap="wrap" gap={8}>
                {member.user.is_active ? (
                  <MotionButton danger onClick={() => onDeactivate(member)}>
                    Deactivate
                  </MotionButton>
                ) : (
                  <Button onClick={() => onReactivate(member)}>Reactivate</Button>
                )}
                {isAdmin ? <Button onClick={() => onResetPassword(member)}>Reset Password</Button> : null}
                {!isModerator ? <Text c="dimmed" size="sm">Moderator access required.</Text> : null}
              </Group>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      ) : null}
    </Modal>
  );
}
