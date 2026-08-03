import type { MemberBadge } from "@guild/shared";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import type { AdminBadgesController, BadgeForm } from "@portal/hooks/useAdminBadgesController";
import {
  ActionIcon,
  Button,
  Checkbox,
  Collapse,
  ColorInput,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { PencilIcon, PlusIcon, TrashIcon, UserCheckIcon, XIcon } from "@portal/components/icons";
import DOMPurify from "dompurify";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import "./AdminBadgesSection.css";

type UserRow = { user: { id: string; username: string }; profile: unknown };

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
      {/*
        * 取色统一走 ColorInput：角色和职业两个页签本来就是它，徽章这里原先是一个
        * 原生 <input type="color"> 外加八个手搓的圆点按钮——同一件事三种控件。
        * COLOR_PRESETS 的值原样交给 swatches：它们是落库的 MemberBadge.color 数据色，
        * 不是主题色（见 inline-colour.test.ts 的豁免表），一个都不能换成 token。
        */}
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
    assignPanelOpen,
    setAssignPanelOpen,
    assignSearch,
    setAssignSearch,
    pendingAssignIds,
    badges,
    assignments,
    selectedBadge,
    assignedUserIds,
    badgesLoading,
    assignmentsLoading,
    badgesError,
    assignmentsError,
    retryBadges,
    retryAssignments,
    createPending,
    updatePending,
    assignPending,
    isBadgeDeletePending,
    isBadgeUnassignPending,
    startCreate,
    startEdit,
    selectBadge,
    cancelEdit,
    openAssignPanel,
    togglePendingAssign,
    formValid,
    createBadge,
    updateBadge,
    deleteBadge,
    assignBadge,
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

  const filteredUsers = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    const available = userRows.filter((r) => !assignedUserIds.has(r.user.id));
    if (!q) return available;
    return available.filter((r) => r.user.username.toLowerCase().includes(q));
  }, [userRows, assignedUserIds, assignSearch]);

  const isEditing = Boolean(editingBadgeId) && Boolean(selectedBadge);

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
                {/* size={44} 是 19788bf「improve tablet accessibility」定的触控靶面，
                    这次只换外框不动尺寸。 */}
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
                <Group justify="space-between" wrap="wrap" gap={8}>
                  <Text size="sm" fw={600}>{t("badges.assignedCount", { count: assignments.length })}</Text>
                  {/*
                    * 加人原先是一个弹窗。弹窗一开就把这枚徽章现有的成员整个盖住，
                    * 而「谁已经有了」正是决定要不要给某人加的依据；关掉弹窗才能回看，
                    * 于是加一个人要开关一次。改成就地展开，两份名单同屏。
                    */}
                  <Button
                    variant={assignPanelOpen ? "light" : "default"}
                    size="sm"
                    aria-expanded={assignPanelOpen}
                    leftSection={<UserCheckIcon size={16} />}
                    onClick={() => (assignPanelOpen ? setAssignPanelOpen(false) : openAssignPanel())}
                  >
                    {t("badges.action.manageMembership")}
                  </Button>
                </Group>

                <Collapse expanded={assignPanelOpen}>
                  <div className="admin-badge-assign">
                    <Stack gap={10}>
                      <div>
                        <Text size="sm" fw={600}>{t("badges.assignTitle")}</Text>
                        <Text size="xs" c="dimmed">{t("badges.assignDescription")}</Text>
                      </div>
                      <TextInput
                        aria-label={t("badges.searchMembers")}
                        placeholder={t("badges.searchMembers")}
                        value={assignSearch}
                        onChange={(e) => { const v = e.currentTarget.value; setAssignSearch(v); }}
                      />
                      <ScrollArea.Autosize mah={220} type="auto" scrollbarSize={6}>
                        <Stack gap={4}>
                          {filteredUsers.map((row) => (
                            <Checkbox
                              key={row.user.id}
                              label={row.user.username}
                              checked={pendingAssignIds.includes(row.user.id)}
                              onChange={() => togglePendingAssign(row.user.id)}
                            />
                          ))}
                          {filteredUsers.length === 0 ? (
                            <Text size="sm" c="dimmed" py={10}>{t("badges.assignNoCandidates")}</Text>
                          ) : null}
                        </Stack>
                      </ScrollArea.Autosize>
                      <Group justify="flex-end" gap={8}>
                        <Button variant="default" size="sm" onClick={() => setAssignPanelOpen(false)}>
                          {t("badges.action.cancel")}
                        </Button>
                        <Button
                          size="sm"
                          disabled={pendingAssignIds.length === 0 || !selectedBadgeId}
                          loading={assignPending}
                          onClick={() => {
                            if (selectedBadgeId) assignBadge(selectedBadgeId, pendingAssignIds);
                          }}
                        >
                          {t("badges.action.assign")} ({pendingAssignIds.length})
                        </Button>
                      </Group>
                    </Stack>
                  </div>
                </Collapse>

                {assignmentsLoading ? (
                  <Stack gap={6}>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={32} />)}</Stack>
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
                  <Stack gap={4}>
                    {assignments.map((a) => (
                      <Group key={a.user_id} justify="space-between" className="admin-badge-assignment-row">
                        <Text size="sm">{a.username ?? a.user_id.slice(0, 8)}</Text>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size={44}
                          aria-label={t("badges.action.unassign")}
                          onClick={() => unassignBadge(selectedBadge.id, [a.user_id])}
                          loading={isBadgeUnassignPending(selectedBadge.id, a.user_id)}
                          disabled={isBadgeUnassignPending(selectedBadge.id, a.user_id)}
                        >
                          <XIcon size={14} />
                        </ActionIcon>
                      </Group>
                    ))}
                  </Stack>
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
