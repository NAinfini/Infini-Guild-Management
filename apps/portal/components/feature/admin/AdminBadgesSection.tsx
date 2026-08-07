import type { MemberBadge } from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import type { AdminBadgesController, BadgeForm } from "@portal/hooks/useAdminBadgesController";
import {
  ActionIcon,
  Button,
  ColorInput,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { PencilIcon, PlusIcon, TrashIcon, UserCheckIcon } from "@portal/components/icons";
import DOMPurify from "dompurify";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import { MemberRoleAvatar } from "../../shared/MemberRoleAvatar";
import { PickList } from "../../shared/PickList";
import { AdminBadgeMemberList } from "./AdminBadgeMemberList";
import "./AdminBadgesSection.css";

export type AdminBadgeMemberRow = {
  user: { id: string; username: string };
  profile: { classes: readonly string[]; power: number; avatar_key: string | null };
};
type UserRow = AdminBadgeMemberRow;

type AdminBadgesSectionProps = {
  userRows: UserRow[];
  controller: AdminBadgesController;
};

const COLOR_PRESETS = ["#D4A843", "#ef4444", "#22c55e", "#f59e0b", "#8B7355", "#ec4899", "#C17F3E", "#f97316"];

const ALLOWED_TAGS = ["span", "b", "strong", "i", "em", "u", "br"];

function sanitizeLabel(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["style"],
  });
}

function BadgeFormFields({
  form,
  setForm,
  preview,
}: {
  form: BadgeForm;
  setForm: React.Dispatch<React.SetStateAction<BadgeForm>>;
  preview?: boolean;
}) {
  const { t } = useTranslation("admin");
  return (
    <>
      <TextInput
        label={t("badges.field.name")}
        placeholder={t("badges.placeholder.name")}
        value={form.name}
        onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, name: v })); }}
      />
      <TextInput
        label={t("badges.field.labelHtml")}
        placeholder={t("badges.placeholder.labelHtml")}
        value={form.label_html}
        onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, label_html: v })); }}
      />
      {/* Presets are persisted badge data, not theme tokens. */}
      <ColorInput
        label={t("badges.field.color")}
        format="hex"
        value={form.color}
        swatches={COLOR_PRESETS}
        eyeDropperButtonProps={{ "aria-label": t("badges.field.colorPicker") }}
        onChange={(v) => setForm((f) => ({ ...f, color: v }))}
      />
      <TextInput
        label={t("badges.field.description")}
        placeholder={t("badges.placeholder.description")}
        value={form.description}
        onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, description: v })); }}
      />
      {preview !== false && form.label_html.trim() ? (
        <div className="admin-badge-preview">
          <Text size="xs" c="dimmed">{t("badges.preview")}</Text>
          <span
            className="admin-badge-preview__pill"
            style={{ "--badge-color": form.color } as React.CSSProperties}
            dangerouslySetInnerHTML={{ __html: sanitizeLabel(form.label_html) }}
          />
        </div>
      ) : null}
    </>
  );
}

export function AdminBadgesSection({ userRows, controller }: AdminBadgesSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const {
    selectedBadgeId,
    editingBadgeId,
    isCreating,
    form,
    setForm,
    membershipOpen,
    memberSearch,
    setMemberSearch,
    draftMemberIds,
    draftAdded,
    draftRemoved,
    badges,
    assignments,
    selectedBadge,
    badgesLoading,
    assignmentsLoading,
    badgesError,
    assignmentsError,
    retryBadges,
    retryAssignments,
    createPending,
    updatePending,
    membershipPending,
    isBadgeDeletePending,
    isBadgeUnassignPending,
    startCreate,
    startEdit,
    selectBadge,
    cancelEdit,
    openMembership,
    closeMembership,
    toggleDraftMember,
    formValid,
    createBadge,
    updateBadge,
    deleteBadge,
    saveMembership,
    unassignBadge,
  } = controller;

  const handleDelete = async (badge: MemberBadge) => {
    if (isBadgeDeletePending(badge.id)) {
      return;
    }
    const accepted = await confirm({
      title: t("badges.confirmDelete.title"),
      description: <Text size="sm">{t("badges.confirmDelete.description", { name: badge.name })}</Text>,
      confirmLabel: t("badges.action.delete"),
      cancelLabel: t("badges.action.cancel"),
      intent: "danger",
    });
    if (accepted) deleteBadge(badge.id);
  };

  /*
   * 面板列的是全体成员，不再只列「还没有这枚徽章的人」：勾选状态本身就表示有没有，
   * 加人和删人是同一份名单上的同一个动作。
   */
  const filteredUsers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return userRows;
    return userRows.filter((r) => r.user.username.toLowerCase().includes(q));
  }, [userRows, memberSearch]);

  const memberById = useMemo(
    () => new Map(userRows.map((row) => [row.user.id, row])),
    [userRows],
  );

  const memberOptions = useMemo(
    () => filteredUsers.map((row) => ({
      id: row.user.id,
      label: row.user.username,
      /* 徽章页认的是人，不是职业配置：头像上再挂三个职业圈，一列名字看起来全是花的。 */
      icon: (
        <MemberRoleAvatar
          user={row.user}
          profile={row.profile}
          size={28}
          withTooltip={false}
          withClassCircles={false}
        />
      ),
    })),
    [filteredUsers],
  );

  const confirmUnassign = (count: number) => confirm({
    title: t("badges.unassignTitle"),
    description: (
      <Text size="sm">
        {t("badges.unassignDescription", { count, badge: selectedBadge?.name ?? "" })}
      </Text>
    ),
    confirmLabel: t("badges.action.unassign"),
    cancelLabel: t("badges.action.cancel"),
    intent: "danger",
  });

  const handleUnassign = async (badgeId: string, userId: string) => {
    if (isBadgeUnassignPending(badgeId, userId)) return;
    if (await confirmUnassign(1)) unassignBadge(badgeId, [userId]);
  };

  /* 差异里含移除时才拦一道：纯新增没有可后悔的东西，弹窗只会变成肌肉记忆。 */
  const handleSaveMembership = async () => {
    if (!selectedBadgeId) return;
    if (draftRemoved.length > 0 && !(await confirmUnassign(draftRemoved.length))) return;
    saveMembership(selectedBadgeId);
  };

  const isEditing = Boolean(editingBadgeId) && Boolean(selectedBadge);
  const membershipDirty = draftAdded.length > 0 || draftRemoved.length > 0;

  return (
    <div className="admin-md">
      <div className="admin-md__master">
        <div className="admin-md__master-head">
          <Group gap={8} justify="space-between" wrap="nowrap">
            <Text fw={700} size="sm">{t("badges.title")}</Text>
            <ActionIcon
              size="sm"
              variant="filled"
              color="portal-brand"
              onClick={startCreate}
              aria-label={t("badges.action.create")}
            >
              <PlusIcon size={14} />
            </ActionIcon>
          </Group>
        </div>

        <ScrollArea className="admin-md__list" type="auto" scrollbarSize={6}>
          <Stack gap={2} p={6}>
            {badgesLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={40} radius="md" />)
            ) : badgesError ? (
              <EmptyState
                status="error"
                title={tc("loadError")}
                actions={(
                  <Button variant="default" size="sm" onClick={retryBadges}>
                    {tc("action.retry")}
                  </Button>
                )}
              />
            ) : badges.length === 0 && !isCreating ? (
              <EmptyState
                title={t("badges.empty")}
                actions={(
                  <Button size="sm" onClick={startCreate}>
                    {t("badges.action.create")}
                  </Button>
                )}
              />
            ) : (
              badges.map((badge) => (
                <button
                  key={badge.id}
                  type="button"
                  className={`admin-md__item ${badge.id === selectedBadgeId ? "admin-md__item--active" : ""}`}
                  onClick={() => selectBadge(badge.id)}
                >
                  <span className="admin-md__item-main">
                    <span
                      className="admin-badge-pill"
                      style={{ "--badge-color": badge.color } as React.CSSProperties}
                      dangerouslySetInnerHTML={{ __html: sanitizeLabel(badge.label_html) }}
                    />
                    <Text size="sm" fw={500} truncate>{badge.name}</Text>
                  </span>
                </button>
              ))
            )}
          </Stack>
        </ScrollArea>
      </div>

      <div className="admin-md__detail">
        {isCreating || isEditing ? (
          <>
            <div className="admin-md__detail-head">
              <Text fw={700} size="sm">{isCreating ? t("badges.createTitle") : t("badges.editTitle")}</Text>
            </div>
            <ScrollArea className="admin-md__detail-body" type="auto" scrollbarSize={6}>
              <Stack gap={12} className="admin-md__detail-pad">
                <BadgeFormFields form={form} setForm={setForm} />
                <Group gap={8}>
                  {isCreating ? (
                    <Button onClick={createBadge} disabled={!formValid} loading={createPending}>
                      {t("badges.action.create")}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => { if (editingBadgeId) updateBadge(editingBadgeId); }}
                      disabled={!formValid}
                      loading={updatePending}
                    >
                      {t("badges.action.save")}
                    </Button>
                  )}
                  <Button variant="default" onClick={cancelEdit}>{t("badges.action.cancel")}</Button>
                </Group>
              </Stack>
            </ScrollArea>
          </>
        ) : selectedBadge ? (
          <>
            <div className="admin-md__detail-head">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
                  <span
                    className="admin-badge-pill admin-badge-pill--lg"
                    style={{ "--badge-color": selectedBadge.color } as React.CSSProperties}
                    dangerouslySetInnerHTML={{ __html: sanitizeLabel(selectedBadge.label_html) }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>{selectedBadge.name}</Text>
                    {selectedBadge.description ? <Text size="xs" c="dimmed">{selectedBadge.description}</Text> : null}
                  </div>
                </Group>
                <Group gap={6} wrap="nowrap">
                  <Tooltip label={t("badges.editTitle")}>
                    <ActionIcon
                      size={44}
                      variant="subtle"
                      aria-label={t("badges.editTitle")}
                      onClick={() => startEdit(selectedBadge)}
                    >
                      <PencilIcon size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t("badges.action.delete")}>
                    <ActionIcon
                      size={44}
                      variant="subtle"
                      color="red"
                      aria-label={t("badges.action.delete")}
                      onClick={() => handleDelete(selectedBadge)}
                      loading={isBadgeDeletePending(selectedBadge.id)}
                      disabled={isBadgeDeletePending(selectedBadge.id)}
                    >
                      <TrashIcon size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            </div>

            <ScrollArea className="admin-md__detail-body" type="auto" scrollbarSize={6}>
              <Stack gap={12} className="admin-md__detail-pad">
                {/* Membership editing waits for the assignment baseline to load. */}
                {membershipOpen ? null : (
                  <Group justify="space-between" wrap="wrap" gap={8}>
                    <Text size="sm" fw={600}>{t("badges.assignedCount", { count: assignments.length })}</Text>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={assignmentsLoading || assignmentsError}
                      leftSection={<UserCheckIcon size={16} />}
                      onClick={openMembership}
                    >
                      {t("badges.action.manageMembership")}
                    </Button>
                  </Group>
                )}

                {membershipOpen ? (
                  <PickList
                    aria-label={t("badges.action.manageMembership")}
                    options={memberOptions}
                    selected={draftMemberIds}
                    onToggle={toggleDraftMember}
                    emptyLabel={t("badges.membership.noMatch")}
                    search={{
                      value: memberSearch,
                      onChange: setMemberSearch,
                      placeholder: t("badges.searchMembers"),
                    }}
                    actions={(
                      <>
                        <Button variant="default" size="sm" onClick={closeMembership}>
                          {t("badges.action.cancel")}
                        </Button>
                        <Button
                          size="sm"
                          disabled={!membershipDirty || !selectedBadgeId}
                          loading={membershipPending}
                          onClick={() => { void handleSaveMembership(); }}
                        >
                          {t("badges.action.saveMembership")}
                        </Button>
                      </>
                    )}
                  />
                ) : assignmentsLoading ? (
                  <Stack gap={4}>
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={44} radius="sm" />)}
                  </Stack>
                ) : assignmentsError ? (
                  <EmptyState
                    status="error"
                    title={tc("loadError")}
                    actions={(
                      <Button variant="default" size="sm" onClick={retryAssignments}>
                        {tc("action.retry")}
                      </Button>
                    )}
                  />
                ) : assignments.length === 0 ? (
                  <Text size="sm" c="dimmed">{t("badges.noMembers")}</Text>
                ) : (
                  <AdminBadgeMemberList
                    assignments={assignments}
                    memberById={memberById}
                    isUnassignPending={(userId) => isBadgeUnassignPending(selectedBadge.id, userId)}
                    onUnassign={(userId) => { void handleUnassign(selectedBadge.id, userId); }}
                  />
                )}
              </Stack>
            </ScrollArea>
          </>
        ) : (
          <div className="admin-md__empty">
            <EmptyState title={t("badges.selectHint")} />
          </div>
        )}
      </div>
    </div>
  );
}
