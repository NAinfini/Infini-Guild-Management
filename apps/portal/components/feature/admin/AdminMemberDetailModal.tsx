import { CLASS_NAMES, type AdminRole } from "@guild/shared";
import { AbsenceManagerCard } from "../../shared/AbsenceManagerCard";
import { PortalCard } from "../../shared/PortalCard";
import {
  Badge,
  Button,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
} from "@mantine/core";
import { SaveIcon } from "@portal/components/icons";
import type { AdminUserRow, MemberDetailFormState } from "@portal/types/admin";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./AdminMemberDetailModal.module.css";

type AdminMemberDetailModalProps = {
  open: boolean;
  member: AdminUserRow | null;
  form: MemberDetailFormState;
  onClose: () => void;
  onFormChange: (patch: Partial<MemberDetailFormState>) => void;
  onSaveProfile: (member: AdminUserRow) => void;
  saveProfilePending: boolean;
  mediaTab: ReactNode;
  roles: AdminRole[];
};

function FieldSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fieldSection}>
      <Text size="xs" c="dimmed" className={styles.fieldSectionLabel}>{label}</Text>
      {children}
    </div>
  );
}

export function AdminMemberDetailModal({
  open,
  member,
  form,
  onClose,
  onFormChange,
  onSaveProfile,
  saveProfilePending,
  mediaTab,
  roles,
}: AdminMemberDetailModalProps) {
  const { t } = useTranslation("admin");

  return (
    <Modal
      opened={open}
      title={member ? t("detail.titleWithName", { username: member.user.username }) : undefined}
      onClose={onClose}
      size="min(960px, 96vw)"
      centered
      classNames={{ content: styles.modalContent }}
    >
      {member ? (
        <Stack gap={0}>
          <Tabs defaultValue="overview" classNames={{ panel: styles.tabPanel }}>
            <Tabs.List className={styles.tabList}>
              <Tabs.Tab value="overview">{t("detail.tab.overview")}</Tabs.Tab>
              <Tabs.Tab value="profile">{t("detail.tab.profile")}</Tabs.Tab>
              <Tabs.Tab value="status">{t("detail.tab.status")}</Tabs.Tab>
              <Tabs.Tab value="media">{t("detail.tab.media")}</Tabs.Tab>
            </Tabs.List>

            {/* Overview: Identity + Combat */}
            <Tabs.Panel value="overview">
              <Stack gap={16}>
                <PortalCard interactive={false}>
                  <div className={styles.sectionBody}>
                    <Text fw={600} size="sm" className={styles.sectionTitle}>{t("detail.section.identity")}</Text>
                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                      <FieldSection label={t("detail.field.username")}>
                        <Text fw={600}>{member.user.username}</Text>
                      </FieldSection>

                      <FieldSection label={t("detail.field.role")}>
                        <Select
                          value={form.role}
                          onChange={(value) => { if (value) onFormChange({ role: value }); }}
                          data={roles
                            .slice()
                            .sort((a, b) => a.level - b.level)
                            .map((r) => ({ value: r.id, label: r.name }))
                          }
                          size="sm"
                        />
                      </FieldSection>

                      <FieldSection label={t("detail.field.status")}>
                        <Group gap={8}>
                          <Switch
                            checked={form.isActive}
                            onChange={(event) => onFormChange({ isActive: event.currentTarget.checked })}
                            size="sm"
                          />
                          <Badge
                            color={form.isActive ? "green" : "red"}
                            variant="light"
                          >
                            {form.isActive ? t("member.status.active") : t("member.status.inactive")}
                          </Badge>
                        </Group>
                      </FieldSection>
                    </SimpleGrid>
                  </div>
                </PortalCard>

                <PortalCard interactive={false}>
                  <div className={styles.sectionBody}>
                    <Text fw={600} size="sm" className={styles.sectionTitle}>{t("detail.section.combat")}</Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                      <NumberInput
                        label={t("detail.field.power")}
                        placeholder={t("detail.placeholder.power")}
                        value={form.power}
                        onChange={(value) => { if (typeof value === "number") onFormChange({ power: value }); }}
                        min={0}
                        decimalScale={2}
                        hideControls
                        thousandSeparator=","
                      />
                      <MultiSelect
                        label={t("detail.field.classes")}
                        placeholder={t("detail.placeholder.classes")}
                        value={form.classes}
                        onChange={(value) => onFormChange({ classes: value })}
                        data={CLASS_NAMES.map((name) => ({ value: name, label: name }))}
                        searchable
                        clearable
                      />
                    </SimpleGrid>
                  </div>
                </PortalCard>
              </Stack>
            </Tabs.Panel>

            {/* Profile: Title, Bio */}
            <Tabs.Panel value="profile">
              <Stack gap={16}>
                <PortalCard interactive={false}>
                  <div className={styles.sectionBody}>
                    <Text fw={600} size="sm" className={styles.sectionTitle}>{t("detail.section.profile")}</Text>
                    <Stack gap="sm">
                      <Textarea
                        label={t("detail.field.titleHtml")}
                        placeholder={t("detail.placeholder.titleHtml")}
                        value={form.titleHtml}
                        onChange={(event) => onFormChange({ titleHtml: event.currentTarget.value })}
                        minRows={2}
                        autosize
                      />
                      <Textarea
                        label={t("detail.field.bio")}
                        placeholder={t("detail.placeholder.bio")}
                        value={form.bio}
                        onChange={(event) => onFormChange({ bio: event.currentTarget.value })}
                        minRows={3}
                        autosize
                      />
                    </Stack>
                  </div>
                </PortalCard>
              </Stack>
            </Tabs.Panel>

            {/* Status: Absences + Notes */}
            <Tabs.Panel value="status">
              <Stack gap={16}>
                <PortalCard interactive={false}>
                  <div className={styles.sectionBody}>
                    <Text fw={600} size="sm" className={styles.sectionTitle}>{t("detail.section.vacation")}</Text>
                    <AbsenceManagerCard userId={member.user.id} />
                  </div>
                </PortalCard>

                <PortalCard interactive={false}>
                  <div className={styles.sectionBody}>
                    <Text fw={600} size="sm" className={styles.sectionTitle}>{t("detail.section.notes")}</Text>
                    <Textarea
                      placeholder={t("detail.placeholder.notes")}
                      value={form.notes}
                      onChange={(event) => onFormChange({ notes: event.currentTarget.value })}
                      minRows={3}
                      autosize
                    />
                  </div>
                </PortalCard>
              </Stack>
            </Tabs.Panel>

            {/* Media */}
            <Tabs.Panel value="media">
              {mediaTab}
            </Tabs.Panel>
          </Tabs>

          {/* Save Button — always visible across all tabs */}
          <Group justify="flex-end" className={styles.saveBar}>
            <Button
              leftSection={<SaveIcon size={18} />}
              onClick={() => onSaveProfile(member)}
              loading={saveProfilePending}
              size="md"
            >
              {t("detail.saveProfile")}
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  );
}
