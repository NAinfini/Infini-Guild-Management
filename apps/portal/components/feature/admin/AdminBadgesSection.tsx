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
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { ScrollArea } from "@portal/components/ui/scroll-area";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { PaletteIcon, PlusIcon, TrashIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import type { AdminBadgesController, BadgeForm } from "@portal/hooks/useAdminBadgesController";
import { verticalDragTransform } from "@portal/utils/sortable-transform";
import { IconGripVertical } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import { LabelStyleModal } from "../../shared/LabelStyleModal";
import { MemberBadgeChip } from "../../shared/MemberCard";
import { MemberRoleAvatar } from "../../shared/MemberRoleAvatar";
import { PickList } from "../../shared/PickList";
import "./AdminBadgesSection.css";

export type AdminBadgeMemberRow = {
  user: { id: string; display_name: string };
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
      <button
        type="button"
        className={`admin-md__item ${active ? "admin-md__item--active" : ""}`}
        onClick={onOpen}
      >
        <span className="admin-md__item-main">
          <span className="admin-md__item-label">{badge.name}</span>
        </span>
      </button>
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
    <div className="admin-badges__fields">
      <div className="admin-md__field">
        <Label htmlFor="badge-name">{t("badges.field.name")}</Label>
        <Input
          id="badge-name"
          placeholder={t("badges.placeholder.name")}
          value={form.name}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setForm((current) => ({ ...current, name: value }));
          }}
        />
      </div>

      <div className="admin-badge-label">
        <span className="admin-md__field-label">{t("badges.field.label")}</span>
        <div className="admin-badge-label__controls">
          {form.label_html.trim() ? (
            <span className="admin-badge-label__preview">
              <MemberBadgeChip
                badge={{
                  id: "badge-form-preview",
                  name: form.name,
                  label_html: form.label_html,
                  color: form.color,
                }}
              />
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("badges.action.openLabelEditor")}
                  onClick={() => setLabelEditorOpen(true)}
                />
              )}
            >
              <PaletteIcon size={16} />
            </TooltipTrigger>
            <TooltipContent>{t("badges.action.openLabelEditor")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="admin-md__field">
        <Label htmlFor="badge-description">{t("badges.field.description")}</Label>
        <Input
          id="badge-description"
          placeholder={t("badges.placeholder.description")}
          value={form.description}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setForm((current) => ({ ...current, description: value }));
          }}
        />
      </div>

      {/* 排序只由左栏拖拽更新，编辑表单不写 sort_order。 */}
      {labelEditorOpen ? (
        <LabelStyleModal
          opened
          onClose={() => setLabelEditorOpen(false)}
          heading={t("badges.labelEditor.title")}
          initialHtml={form.label_html}
          initialColor={form.color}
          defaultText={t("badges.placeholder.label")}
          applyLabel={t("badges.action.applyLabel")}
          onApply={({ html, color }) => setForm((current) => ({ ...current, label_html: html, color }))}
        />
      ) : null}
    </div>
  );
}

export function AdminBadgesSection({ userRows, controller }: AdminBadgesSectionProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const confirm = useConfirmDialog();
  const {
    selectedBadgeId,
    isCreating,
    form,
    setForm,
    memberSearch,
    setMemberSearch,
    draftMemberIds,
    draftRemoved,
    badges,
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
    startCreate,
    selectBadge,
    discardChanges,
    toggleDraftMember,
    formValid,
    formDirty,
    membershipDirty,
    isDirty,
    createBadge,
    updateBadge,
    deleteBadge,
    saveMembership,
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
    if (isBadgeDeletePending(badge.id)) return;

    const accepted = await confirm({
      title: t("badges.confirmDelete.title"),
      description: (
        <p className="admin-md__confirmation-copy">
          {t("badges.confirmDelete.description", { name: badge.name })}
        </p>
      ),
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
    const query = memberSearch.trim().toLowerCase();
    if (!query) return userRows;
    return userRows.filter((row) => row.user.display_name.toLowerCase().includes(query));
  }, [userRows, memberSearch]);

  const memberOptions = useMemo(
    () => filteredUsers.map((row) => ({
      id: row.user.id,
      label: row.user.display_name,
      disabled: assignmentsLoading || assignmentsError,
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
    [assignmentsError, assignmentsLoading, filteredUsers],
  );

  const confirmUnassign = (count: number) => confirm({
    title: t("badges.unassignTitle"),
    description: (
      <p className="admin-md__confirmation-copy">
        {t("badges.unassignDescription", { count, badge: selectedBadge?.name ?? "" })}
      </p>
    ),
    confirmLabel: t("badges.action.unassign"),
    cancelLabel: t("badges.action.cancel"),
    intent: "danger",
  });

  /* 差异里含移除时才拦一道：纯新增没有可后悔的东西，弹窗只会变成肌肉记忆。 */
  const handleSaveMembership = async () => {
    if (!selectedBadgeId) return;
    if (draftRemoved.length > 0 && !(await confirmUnassign(draftRemoved.length))) return;
    saveMembership(selectedBadgeId);
  };

  return (
    <div className="admin-panel admin-md">
      <div className="admin-md__master">
        <div className="admin-md__master-head">
          <div className="admin-md__master-head-row">
            <span className="admin-md__master-title">{t("badges.title")}</span>
            <Button
              type="button"
              size="icon-sm"
              aria-label={t("badges.action.create")}
              onClick={startCreate}
            >
              <PlusIcon size={14} />
            </Button>
          </div>
        </div>

        <ScrollArea className="admin-md__list">
          <div className="admin-md__list-stack">
            {badgesLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="admin-md__skeleton" />
              ))
            ) : badgesError ? (
              <EmptyState
                status="error"
                title={tc("loadError")}
                actions={(
                  <Button variant="outline" size="sm" onClick={retryBadges}>
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
          </div>
        </ScrollArea>
      </div>

      <div className="admin-md__detail">
        {isCreating || selectedBadge ? (
          <>
            <div className="admin-md__detail-head">
              <div className="admin-md__detail-head-row">
                <div className="admin-md__detail-heading">
                  <span className="admin-md__detail-title">
                    {isCreating ? t("badges.createTitle") : t("badges.editTitle")}
                  </span>
                  {isDirty ? <Badge variant="outline" className="admin-md__dirty">{t("badges.dirty")}</Badge> : null}
                </div>
                {selectedBadge ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-lg"
                          className="admin-md__delete-action"
                          aria-label={t("badges.action.delete")}
                          onClick={() => void handleDelete(selectedBadge)}
                          loading={isBadgeDeletePending(selectedBadge.id)}
                          disabled={isBadgeDeletePending(selectedBadge.id)}
                        />
                      )}
                    >
                      <TrashIcon size={16} />
                    </TooltipTrigger>
                    <TooltipContent>{t("badges.action.delete")}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>
            <ScrollArea className="admin-md__detail-body">
              <div className="admin-md__detail-pad admin-md__detail-stack">
                <BadgeFormFields form={form} setForm={setForm} />
                {selectedBadge ? (
                  <div className="admin-badges__membership">
                    <div className="admin-badges__membership-head">
                      <span className="admin-badges__membership-title">
                        {t("badges.assignedCount", { count: draftMemberIds.size })}
                      </span>
                      {assignmentsLoading ? (
                        <span className="admin-md__muted">{t("badges.membership.loading")}</span>
                      ) : null}
                      {assignmentsError ? (
                        <Button variant="outline" size="xs" onClick={retryAssignments}>
                          {tc("action.retry")}
                        </Button>
                      ) : null}
                    </div>
                    <PickList
                      aria-label={t("badges.field.members")}
                      options={memberOptions}
                      selected={draftMemberIds}
                      onToggle={toggleDraftMember}
                      emptyLabel={t("badges.membership.noMatch")}
                      search={{
                        value: memberSearch,
                        onChange: setMemberSearch,
                        placeholder: t("badges.searchMembers"),
                      }}
                    />
                  </div>
                ) : (
                  <span className="admin-md__muted">{t("badges.membership.createFirst")}</span>
                )}
              </div>
            </ScrollArea>
            <div className="admin-md__detail-foot">
              <div className="admin-md__detail-actions">
                <Button variant="outline" onClick={discardChanges} disabled={!isDirty}>
                  {t("badges.action.cancel")}
                </Button>
                {isCreating ? (
                  <Button onClick={createBadge} disabled={!formValid || !isDirty} loading={createPending}>
                    {t("badges.action.create")}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => { if (selectedBadgeId) updateBadge(selectedBadgeId); }}
                      disabled={!formValid || !formDirty || !selectedBadgeId}
                      loading={updatePending}
                    >
                      {t("badges.action.save")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!membershipDirty || !selectedBadgeId || assignmentsLoading || assignmentsError}
                      loading={membershipPending}
                      onClick={() => { void handleSaveMembership(); }}
                    >
                      {t("badges.action.saveMembership")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
