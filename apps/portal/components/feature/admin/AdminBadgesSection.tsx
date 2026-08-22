import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { MemberBadge } from "@guild/shared";
import { verticalDragTransform } from "@portal/utils/sortable-transform";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import type { AdminBadgesController, BadgeForm } from "@portal/hooks/useAdminBadgesController";
import {
  ActionIcon,
  Button,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { PaletteIcon, PencilIcon, PlusIcon, TrashIcon, UserCheckIcon } from "@portal/components/icons";
import { IconGripVertical } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import { LabelStyleModal } from "../../shared/LabelStyleModal";
import { MemberBadgeChip } from "../../shared/MemberCard";
import { MemberRoleAvatar } from "../../shared/MemberRoleAvatar";
import { PickList } from "../../shared/PickList";
import { AdminBadgeMemberList } from "./AdminBadgeMemberList";
import "./AdminBadgesSection.css";

export type AdminBadgeMemberRow = {
  user: { id: string; username: string };
  profile: { classes: readonly string[]; power: number; avatar_media_id: string | null };
};
type UserRow = AdminBadgeMemberRow;

type AdminBadgesSectionProps = {
  userRows: UserRow[];
  controller: AdminBadgesController;
};

/*
 * 清单行 = 一个「点开这枚徽章」按钮 + 一个拖拽手柄，手柄在右。手柄单独拆出来的
 * 理由和职业目录那份一样（AdminClassesSection.tsx），不在这里重复一遍。
 */
function SortableBadgeRow({
  badge,
  active,
  disabled,
  onOpen,
}: {
  badge: MemberBadge;
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation("admin");
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: badge.id, disabled });
  const style: CSSProperties = {
    transform: verticalDragTransform(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`admin-md__row ${active ? "admin-md__row--active" : ""}`}
    >
      <UnstyledButton
        className={`admin-md__item ${active ? "admin-md__item--active" : ""}`}
        onClick={onOpen}
      >
        <span className="admin-md__item-main">
          <Text size="sm" fw={500} truncate>{badge.name}</Text>
        </span>
      </UnstyledButton>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="admin-md__grip"
        aria-label={t("badges.aria.dragHandle", { name: badge.name })}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <IconGripVertical size={14} />
      </button>
    </div>
  );
}

/*
 * 标签和颜色都出自同一个样式编辑器（成员称号用的也是它）：管理员挑的那一个色号
 * 既拼进 label_html 的 `color:`，也存进 badge.color 当药丸底色，两处不可能对不上。
 * 手写 `<span style>` 和另一个取色器是同一件事的第二套入口，已经删掉。
 *
 * 编辑器关掉之后表单里就只剩一个按钮，看不出这枚徽章现在长什么样。预览直接用
 * 成员卡那枚 MemberBadgeChip：药丸样式和 HTML 清洗白名单都还是同一份，
 * 不构成第二个渲染点。没有标签时不占位——空药丸只是一圈没有内容的描边。
 */
function BadgeFormFields({
  form,
  setForm,
}: {
  form: BadgeForm;
  setForm: React.Dispatch<React.SetStateAction<BadgeForm>>;
}) {
  const { t } = useTranslation("admin");
  const [labelEditorOpen, setLabelEditorOpen] = useState(false);

  return (
    <>
      <TextInput
        label={t("badges.field.name")}
        placeholder={t("badges.placeholder.name")}
        value={form.name}
        onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, name: v })); }}
      />

      <div className="admin-badge-label">
        <Text component="span" size="sm" fw={500}>{t("badges.field.label")}</Text>
        <Group gap={8}>
          {form.label_html.trim() ? (
            <span className="admin-badge-label__preview">
              <MemberBadgeChip
                badge={{ id: "badge-form-preview", name: form.name, label_html: form.label_html, color: form.color }}
              />
            </span>
          ) : null}
          {/* 只留图标，名字挂在 aria-label 和 tooltip 上；预览是这一行的主角，按钮让位。 */}
          <Tooltip label={t("badges.action.openLabelEditor")}>
            <ActionIcon
              variant="default"
              size="lg"
              aria-label={t("badges.action.openLabelEditor")}
              onClick={() => setLabelEditorOpen(true)}
            >
              <PaletteIcon size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      <TextInput
        label={t("badges.field.description")}
        placeholder={t("badges.placeholder.description")}
        value={form.description}
        onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, description: v })); }}
      />
      {/* 排序只由左栏拖拽更新，编辑表单不写 sort_order。 */}

      {/* 只在打开时挂载：编辑器把 initialHtml / initialColor 当初值收下，
          常驻一份会一直停在它打开时的那一枚徽章上。 */}
      {labelEditorOpen ? (
        <LabelStyleModal
          opened
          onClose={() => setLabelEditorOpen(false)}
          heading={t("badges.labelEditor.title")}
          initialHtml={form.label_html}
          initialColor={form.color}
          defaultText={t("badges.placeholder.label")}
          applyLabel={t("badges.action.applyLabel")}
          onApply={({ html, color }) => setForm((f) => ({ ...f, label_html: html, color }))}
        />
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
    reorderBadges,
    reorderPending,
  } = controller;

  /* 键盘也要能排：只有指针传感器的话，手柄能聚焦却按不动。 */
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    reorderBadges(String(event.active.id), String(event.over.id));
  };

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
    <div className="admin-panel admin-md">
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                /* 键盘排序必须持续重新测量，理由同 AdminClassesSection.tsx。 */
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={badges.map((badge) => badge.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {badges.map((badge) => (
                    <SortableBadgeRow
                      key={badge.id}
                      badge={badge}
                      active={badge.id === selectedBadgeId}
                      /* 上一次重排还在飞时不允许再拖：两个 PATCH 并发时，先发的那个
                         响应可能后到，onSuccess 会把它的旧顺序写回缓存。 */
                      disabled={reorderPending}
                      onOpen={() => selectBadge(badge.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
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
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} truncate>{selectedBadge.name}</Text>
                  {selectedBadge.description ? <Text size="xs" c="dimmed">{selectedBadge.description}</Text> : null}
                </div>
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
        ) : null /* 选中项现在有兜底，走到这里只剩「一枚徽章都没有」，
                    而左栏那块空状态已经把这件事和「去新建」说完了。 */}
      </div>
    </div>
  );
}
