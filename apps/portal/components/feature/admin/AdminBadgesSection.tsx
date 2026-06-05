import type { MemberBadge } from "@guild/shared";
import { DepthButton } from "@portal/components/shared/DepthButton";
import type { AdminBadgesController, BadgeForm } from "@portal/hooks/useAdminBadgesController";
import {
  ActionIcon,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
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
      <div>
        <Text size="sm" fw={500} mb={4}>{t("badges.field.color")}</Text>
        <div className="admin-badge-color-row">
          <input
            type="color"
            className="admin-badge-color-picker"
            value={form.color}
            aria-label={t("badges.field.color")}
            onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, color: v })); }}
          />
          <div className="admin-badge-swatches">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`admin-badge-swatch${form.color === c ? " admin-badge-swatch--active" : ""}`}
                style={{ background: c }}
                aria-label={t("badges.aria.selectColor", { color: c, defaultValue: "Select badge color {{color}}" })}
                title={c}
                onClick={() => setForm((f) => ({ ...f, color: c }))}
              />
            ))}
          </div>
        </div>
      </div>
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
  const {
    selectedBadgeId,
    editingBadgeId,
    isCreating,
    form,
    setForm,
    assignModalOpen,
    setAssignModalOpen,
    assignSearch,
    setAssignSearch,
    pendingAssignIds,
    badges,
    assignments,
    selectedBadge,
    assignedUserIds,
    badgesLoading,
    assignmentsLoading,
    createPending,
    updatePending,
    assignPending,
    unassignPending,
    startCreate,
    startEdit,
    selectBadge,
    cancelEdit,
    openAssignModal,
    togglePendingAssign,
    formValid,
    createBadge,
    updateBadge,
    deleteBadge,
    assignBadge,
    unassignBadge,
  } = controller;

  const handleDelete = (badge: MemberBadge) => {
    modals.openConfirmModal({
      title: t("badges.confirmDelete.title"),
      children: <Text size="sm">{t("badges.confirmDelete.description", { name: badge.name })}</Text>,
      confirmProps: { color: "red" },
      labels: { confirm: t("badges.action.delete"), cancel: t("badges.action.cancel") },
      onConfirm: () => deleteBadge(badge.id),
    });
  };

  const filteredUsers = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    const available = userRows.filter((r) => !assignedUserIds.has(r.user.id));
    if (!q) return available;
    return available.filter((r) => r.user.username.toLowerCase().includes(q));
  }, [userRows, assignedUserIds, assignSearch]);

  return (
    <div className="admin-badges-section">
      <div className="admin-badges-sidebar">
        <Stack gap={8}>
          <Group justify="space-between">
            <Text fw={600}>{t("badges.title")}</Text>
            <DepthButton type="primary" size="sm" onClick={startCreate} aria-label={t("badges.action.create")}>
              <PlusIcon size={16} />
            </DepthButton>
          </Group>

          {badgesLoading ? (
            <Stack gap={6}>
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={40} radius="md" />)}
            </Stack>
          ) : badges.length === 0 && !isCreating ? (
            <EmptyState title={t("badges.empty")} />
          ) : (
            <Stack gap={4}>
              {badges.map((badge) => (
                <button
                  key={badge.id}
                  type="button"
                  className={`admin-badge-item ${badge.id === selectedBadgeId ? "admin-badge-item--active" : ""}`}
                  onClick={() => selectBadge(badge.id)}
                >
                  <Group gap={8} wrap="nowrap">
                    <span
                      className="admin-badge-pill"
                      style={{ "--badge-color": badge.color } as React.CSSProperties}
                      dangerouslySetInnerHTML={{ __html: sanitizeLabel(badge.label_html) }}
                    />
                    <Text size="sm" fw={500} lineClamp={1}>{badge.name}</Text>
                  </Group>
                </button>
              ))}
            </Stack>
          )}
        </Stack>
      </div>

      <div className="admin-badges-detail">
        {isCreating ? (
          <Stack gap={12}>
            <Text fw={600}>{t("badges.createTitle")}</Text>
            <BadgeFormFields form={form} setForm={setForm} />
            <Group gap={8}>
              <DepthButton type="primary" onClick={createBadge} disabled={!formValid} loading={createPending}>{t("badges.action.create")}</DepthButton>
              <DepthButton type="secondary" onClick={cancelEdit}>{t("badges.action.cancel")}</DepthButton>
            </Group>
          </Stack>
        ) : editingBadgeId && selectedBadge ? (
          <Stack gap={12}>
            <Text fw={600}>{t("badges.editTitle")}</Text>
            <BadgeFormFields form={form} setForm={setForm} />
            <Group gap={8}>
              <DepthButton type="primary" onClick={() => updateBadge(editingBadgeId)} disabled={!formValid} loading={updatePending}>{t("badges.action.save")}</DepthButton>
              <DepthButton type="secondary" onClick={cancelEdit}>{t("badges.action.cancel")}</DepthButton>
            </Group>
          </Stack>
        ) : selectedBadge ? (
          <Stack gap={12}>
            <Group justify="space-between" align="start">
              <Group gap={10}>
                <span
                  className="admin-badge-pill admin-badge-pill--lg"
                  style={{ "--badge-color": selectedBadge.color } as React.CSSProperties}
                  dangerouslySetInnerHTML={{ __html: sanitizeLabel(selectedBadge.label_html) }}
                />
                <div>
                  <Text fw={600}>{selectedBadge.name}</Text>
                  {selectedBadge.description ? <Text size="xs" c="dimmed">{selectedBadge.description}</Text> : null}
                </div>
              </Group>
              <Group gap={6}>
                <Tooltip label={t("badges.action.manageMembership")}>
                  <ActionIcon variant="subtle" aria-label={t("badges.action.manageMembership")} onClick={openAssignModal}><UserCheckIcon size={16} /></ActionIcon>
                </Tooltip>
                <Tooltip label={t("badges.editTitle")}>
                  <ActionIcon variant="subtle" aria-label={t("badges.editTitle")} onClick={() => startEdit(selectedBadge)}><PencilIcon size={16} /></ActionIcon>
                </Tooltip>
                <Tooltip label={t("badges.action.delete")}>
                  <ActionIcon variant="subtle" color="red" aria-label={t("badges.action.delete")} onClick={() => handleDelete(selectedBadge)}><TrashIcon size={16} /></ActionIcon>
                </Tooltip>
              </Group>
            </Group>

            <Text size="sm" fw={600}>{t("badges.assignedCount", { count: assignments.length })}</Text>

            {assignmentsLoading ? (
              <Stack gap={6}>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={32} />)}</Stack>
            ) : assignments.length === 0 ? (
              <Text size="sm" c="dimmed">{t("badges.noMembers")}</Text>
            ) : (
              <ScrollArea.Autosize mah={400}>
                <Stack gap={4}>
                  {assignments.map((a) => (
                    <Group key={a.user_id} justify="space-between" className="admin-badge-assignment-row">
                      <Text size="sm">{a.username ?? a.user_id.slice(0, 8)}</Text>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        aria-label={t("badges.action.unassign")}
                        onClick={() => unassignBadge(selectedBadge.id, [a.user_id])}
                        loading={unassignPending}
                      >
                        <XIcon size={14} />
                      </ActionIcon>
                    </Group>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </Stack>
        ) : (
          <EmptyState title={t("badges.selectHint")} />
        )}
      </div>

      <Modal opened={assignModalOpen} onClose={() => setAssignModalOpen(false)} title={t("badges.assignTitle")} size="md">
        <Stack gap={10}>
          <Text size="sm" c="dimmed">{t("badges.assignDescription")}</Text>
          <TextInput placeholder={t("badges.searchMembers")} value={assignSearch} onChange={(e) => { const v = e.currentTarget.value; setAssignSearch(v); }} />
          <ScrollArea.Autosize mah={300}>
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
                <Text size="sm" c="dimmed" ta="center" py={10}>{t("badges.noMembers")}</Text>
              ) : null}
            </Stack>
          </ScrollArea.Autosize>
          <Group justify="flex-end">
            <DepthButton
              type="primary"
              disabled={pendingAssignIds.length === 0 || !selectedBadgeId}
              loading={assignPending}
              onClick={() => {
                if (selectedBadgeId) assignBadge(selectedBadgeId, pendingAssignIds);
              }}
            >
              {t("badges.action.assign")} ({pendingAssignIds.length})
            </DepthButton>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
