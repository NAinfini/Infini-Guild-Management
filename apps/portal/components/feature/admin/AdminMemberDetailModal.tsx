import type { AdminRole } from "@guild/shared";
import { AbsenceManagerCard } from "../../shared/AbsenceManagerCard";
import {
  Badge,
  Button,
  Group,
  Input,
  Modal,
  Paper,
  MultiSelect,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@mantine/core";
import { SaveIcon } from "@portal/components/icons";
import { isOnVacation } from "@portal/components/shared/MemberCard";
import { ProfileOverviewCard } from "@portal/components/shared/ProfileOverviewCard";
import { TitleField } from "../../shared/TitleField";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import type { AdminUserRow, MemberDetailFormState } from "@portal/types/admin";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./AdminMemberDetailModal.module.css";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { buildClassOptions, resolveClassCatalogItem } from "@portal/utils/class-catalog";
import { useAuthStore } from "@portal/stores/auth";
import { formatCalendarDate } from "@portal/utils/datetime";
import { canManageUserByRoleLevel } from "@portal/utils/permissions";

/* 弹窗只有看和改两种态。 */
type DetailView = "read" | "edit";

type AdminMemberDetailModalProps = {
  open: boolean;
  member: AdminUserRow | null;
  form: MemberDetailFormState;
  isDirty: boolean;
  onClose: () => void;
  onFormChange: (patch: Partial<MemberDetailFormState>) => void;
  onResetForm: () => void;
  onSaveProfile: (member: AdminUserRow) => void;
  saveProfilePending: boolean;
  mediaTab: ReactNode;
  roles: AdminRole[];
  canEditProfile: boolean;
  canAssignRole: boolean;
  canActivate: boolean;
};

function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper withBorder radius="md">
      <div className={styles.sectionBody}>
        <Group justify="space-between" align="center" wrap="nowrap" className={styles.sectionHeader}>
          <Text fw={600} size="sm" className={styles.sectionTitle}>{title}</Text>
          {action}
        </Group>
        {children}
      </div>
    </Paper>
  );
}

/* 无权改的那一组在编辑态照样出现，只是把值摊平成一行文本。灰掉的下拉框不传达
   任何信息，一行值至少是诚实的；整组藏掉又会让人以为这个成员没有这些字段。
   标签沿用 Input.Wrapper，和同一格里 Mantine 控件自带的标签是同一套排版——
   自己写一份就会在同一行里出现两种字号。 */
function ReadonlyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Input.Wrapper label={label}>
      {typeof children === "string" ? <Text fw={600}>{children}</Text> : children}
    </Input.Wrapper>
  );
}

export function AdminMemberDetailModal({
  open,
  member,
  form,
  isDirty,
  onClose,
  onFormChange,
  onResetForm,
  onSaveProfile,
  saveProfilePending,
  mediaTab,
  roles,
  canEditProfile,
  canAssignRole,
  canActivate,
}: AdminMemberDetailModalProps) {
  const { t, i18n } = useTranslation("admin");
  const confirm = useConfirmDialog();
  const classCatalog = useClassCatalog();
  const currentUser = useAuthStore((state) => state.user);
  const classOptions = buildClassOptions(classCatalog);
  const canManageTarget = Boolean(member && canManageUserByRoleLevel(member.user, currentUser));
  const canEditMember = canManageTarget && canEditProfile;
  const canAssignMemberRole = canManageTarget && canAssignRole;
  const canActivateMember = canManageTarget && canActivate;
  const canSaveMember = canEditMember || canAssignMemberRole || canActivateMember;
  const selectedRoleIsAssignable = roles.some((role) => role.id === form.role);

  /* 一个「编辑」管全部。请假和媒体虽然写库时机不同，但对使用的人来说都是「改这个
     成员」，拆成各自的入口只会让人在几个屏之间来回找。 */
  const [view, setView] = useState<DetailView>("read");
  const editing = view === "edit";

  /* 换人（含关闭，此时 id 变成 null）就回到只读屏。否则上一位成员的编辑态会原样
     出现在下一位成员的详情里。 */
  const memberId = member?.user.id ?? null;
  useEffect(() => {
    setView("read");
  }, [memberId]);

  const handleCancelEdit = async () => {
    if (isDirty) {
      const confirmed = await confirm({
        title: t("common:unsavedChanges.title"),
        description: t("common:unsavedChanges.message"),
        confirmLabel: t("common:action.discard"),
        cancelLabel: t("common:unsavedChanges.stay"),
        intent: "warning",
      });
      if (!confirmed) return;
      onResetForm();
    }
    setView("read");
  };

  const handleSave = () => {
    if (!member) return;
    onSaveProfile(member);
    /* 保存后回到只读屏，直接看到结果。请求失败时表单草稿还在，重新点「编辑」
       就能接着改。 */
    setView("read");
  };

  /* 请假与媒体各自写库，底下那颗「保存资料」管不到它们。这一句就写在它们上头，
     免得有人改完媒体又去点保存，才发现两者根本不是一回事。 */
  const instantNote = <Text size="xs" c="dimmed">{t("detail.hint.instant")}</Text>;

  const renderBody = (target: AdminUserRow) => {
    /* 请假起止是日历日期，不是瞬时点：按本地时区渲染会让西边的人整整差一天。 */
    const formatDay = (value: string) => formatCalendarDate(value, i18n.language, "numeric");
    const absenceSummary = isOnVacation(target.profile) && target.profile.vacation_start && target.profile.vacation_end
      ? t("detail.absence.active", {
        start: formatDay(target.profile.vacation_start),
        end: formatDay(target.profile.vacation_end),
      })
      : t("detail.absence.none");
    const mediaSummary = t("detail.media.summary", {
      images: target.profile.images.length,
      videos: target.profile.video_urls.length,
      audio: target.profile.audio_media_id
        ? t("detail.media.audioPresent")
        : t("detail.media.audioAbsent"),
    });

    return (
      <Stack gap={16}>
        {/* 概览条在两种态里都留着：只读时它就是这一屏的答案，编辑时它是「你在改谁」
            的锚点。取值跟着当前态走——编辑时读草稿，改完立刻反映；只读时读服务端，
            否则保存失败之后这一条会摆着一个根本没存进去的数字。 */}
        <ProfileOverviewCard
          user={target.user}
          profile={target.profile}
          badges={target.badges}
          power={editing ? form.power : target.profile.power}
          titleHtml={editing ? form.titleHtml : target.profile.title_html ?? ""}
          classList={editing ? form.classes : target.profile.classes}
          imageList={target.profile.images}
          videoList={target.profile.video_urls}
          availabilityData={target.profile.availability}
        />

        {editing ? (
          <>
            <DetailSection title={t("detail.section.identity")}>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {canAssignMemberRole ? (
                  <Select
                    label={t("detail.field.role")}
                    value={selectedRoleIsAssignable ? form.role : null}
                    placeholder={target.user.role_name}
                    onChange={(value) => { if (value) onFormChange({ role: value }); }}
                    data={roles
                      .slice()
                      .sort((a, b) => a.level - b.level)
                      .map((r) => ({ value: r.id, label: r.name }))
                    }
                    size="sm"
                  />
                ) : (
                  <ReadonlyField label={t("detail.field.role")}>{target.user.role_name}</ReadonlyField>
                )}

                {canActivateMember ? (
                  <Input.Wrapper label={t("detail.field.status")}>
                    <Group gap={8}>
                      <Switch
                        checked={form.isActive}
                        onChange={(event) => onFormChange({ isActive: event.currentTarget.checked })}
                        size="sm"
                        aria-label={t("detail.field.status")}
                      />
                      <Badge color={form.isActive ? "green" : "red"} variant="light">
                        {form.isActive ? t("member.status.active") : t("member.status.inactive")}
                      </Badge>
                    </Group>
                  </Input.Wrapper>
                ) : (
                  <ReadonlyField label={t("detail.field.status")}>
                    <Badge color={target.user.is_active ? "green" : "red"} variant="light">
                      {target.user.is_active ? t("member.status.active") : t("member.status.inactive")}
                    </Badge>
                  </ReadonlyField>
                )}
              </SimpleGrid>
            </DetailSection>

            <DetailSection title={t("detail.section.combat")}>
              {canEditMember ? (
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
                    data={classOptions}
                    searchable
                    clearable
                  />
                </SimpleGrid>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <ReadonlyField label={t("detail.field.power")}>
                    {target.profile.power.toLocaleString()}
                  </ReadonlyField>
                  <ReadonlyField label={t("detail.field.classes")}>
                    {target.profile.classes.length > 0
                      ? target.profile.classes
                        .map((id) => resolveClassCatalogItem(id, classCatalog).label)
                        .join(" · ")
                      : t("detail.empty.classes")}
                  </ReadonlyField>
                </SimpleGrid>
              )}
            </DetailSection>

            <DetailSection title={t("detail.section.profile")}>
              {canEditMember ? (
                <Stack gap="sm">
                  {/* 和资料页同一个称号控件：后台不该是「贴一段 HTML」的入口。 */}
                  <TitleField
                    value={form.titleHtml}
                    onChange={(value) => onFormChange({ titleHtml: value })}
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
              ) : (
                <ReadonlyField label={t("detail.field.bio")}>
                  {target.profile.bio?.trim() || t("detail.empty.bio")}
                </ReadonlyField>
              )}
            </DetailSection>

            <DetailSection title={t("detail.section.notes")}>
              {canEditMember ? (
                <Textarea
                  placeholder={t("detail.placeholder.notes")}
                  value={form.notes}
                  onChange={(event) => onFormChange({ notes: event.currentTarget.value })}
                  minRows={3}
                  autosize
                  aria-label={t("detail.section.notes")}
                />
              ) : (
                <Text size="sm">{target.profile.notes?.trim() || t("detail.empty.notes")}</Text>
              )}
            </DetailSection>

            {/* 请假和媒体只在编辑态挂载：只想看一眼这个人是谁的时候，不该付
                useMemberAbsences 和上传器的代价。这两个组件自带标题和边框、本身
                就是一块分区，再套一层 DetailSection 只会得到框中框和两个标题。 */}
            {canEditMember ? (
              <Stack gap={8}>
                {instantNote}
                <Stack gap={16}>
                  <AbsenceManagerCard userId={target.user.id} />
                  {mediaTab}
                </Stack>
              </Stack>
            ) : (
              <>
                <DetailSection title={t("detail.section.vacation")}>
                  <Text size="sm">{absenceSummary}</Text>
                </DetailSection>
                <DetailSection title={t("detail.section.media")}>
                  <Text size="sm">{mediaSummary}</Text>
                </DetailSection>
              </>
            )}

            <Group justify="flex-end" className={styles.saveBar}>
              <Button variant="default" onClick={() => void handleCancelEdit()} size="md">
                {t("common:action.cancel")}
              </Button>
              <Button
                leftSection={<SaveIcon size={18} />}
                onClick={handleSave}
                loading={saveProfilePending}
                disabled={!isDirty || saveProfilePending}
                size="md"
              >
                {t("detail.saveProfile")}
              </Button>
            </Group>
          </>
        ) : (
          <>
            {/* 四块分区两列排。每块只有一两行内容，竖着叠成四条会把弹窗撑满，
                还会让四件不同分量的事看起来一样重。 */}
            <div className={styles.readGrid}>
              <DetailSection title={t("detail.field.bio")}>
                <Text size="sm">{target.profile.bio?.trim() || t("detail.empty.bio")}</Text>
              </DetailSection>

              <DetailSection
                title={t("detail.section.notes")}
                action={<Text size="xs" c="dimmed">{t("detail.notesVisibility")}</Text>}
              >
                <Text size="sm">{target.profile.notes?.trim() || t("detail.empty.notes")}</Text>
              </DetailSection>

              {/* 请假与媒体在这一屏只是两行摘要，改它们和改其余字段一样走「编辑」。 */}
              <DetailSection title={t("detail.section.vacation")}>
                <Text size="sm">{absenceSummary}</Text>
              </DetailSection>

              <DetailSection title={t("detail.section.media")}>
                <Text size="sm">{mediaSummary}</Text>
              </DetailSection>
            </div>

            {/* 动作条和编辑态在同一个位置：换态只换按钮，不让主动作在屏上跳。
                管不了这个成员时把原因写在按钮旁边——禁用的按钮收不到指针事件，
                挂 tooltip 等于把解释藏进一个够不着的地方。 */}
            <Group justify={canSaveMember ? "flex-end" : "space-between"} className={styles.saveBar}>
              {canSaveMember ? null : (
                <Text size="xs" c="dimmed">{t("detail.hint.cannotManage")}</Text>
              )}
              <Button onClick={() => setView("edit")} disabled={!canSaveMember} size="md">
                {t("detail.action.edit")}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    );
  };

  return (
    <Modal
      opened={open}
      title={member ? t("detail.titleWithName", { username: member.user.username }) : undefined}
      onClose={onClose}
      size="min(960px, 96vw)"
      centered
      classNames={{ content: styles.modalContent }}
    >
      {member ? renderBody(member) : null}
    </Modal>
  );
}
