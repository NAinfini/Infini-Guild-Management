import type { AdminRole, InviteLink } from "@guild/shared";
import { Combobox } from "@base-ui/react/combobox";
import { PlusIcon, SearchIcon, XIcon } from "@portal/components/icons";
import {
  ContentFilterGroup,
  ContentFilterOption,
  ContentFilterToolbar,
} from "@portal/components/shared/ContentFilterToolbar";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@portal/components/ui/input-group";
import { Label } from "@portal/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEffectivePermissions } from "../../../hooks/useEffectivePermissions";
import type { InviteLinkStatsSummary } from "../../../services/AdminService";
import { copyPlainText } from "../../../utils/copy";
import { AdminInviteTable } from "./AdminInviteTable";
import { AdminLoadError } from "./AdminLoadError";

type InviteRow = InviteLink;
type InviteStats = InviteLinkStatsSummary;

type AdminInviteSectionProps = {
  inviteVisibility: "active" | "expired" | "revoked";
  onInviteVisibilityChange: (value: "active" | "expired" | "revoked") => void;
  onCreateInvite: (
    input: { roleId: string; maxUses: number; expiresAt: string },
    onSuccess: (invite: InviteLink) => void,
  ) => void;
  roles: AdminRole[];
  createInvitePending: boolean;
  inviteStatsLoading: boolean;
  inviteStats: InviteStats | null;
  inviteLinksLoading: boolean;
  inviteLinksError: boolean;
  onRetryInviteLinks: () => void;
  inviteRows: InviteRow[];
  inviteTotal: number;
  hasMoreInvites: boolean;
  loadingMoreInvites: boolean;
  onLoadMoreInvites: () => void;
  inviteSearch: string;
  onInviteSearchChange: (value: string) => void;
  isInviteInactive: (row: InviteRow) => boolean;
  isInviteActionPending: (inviteId: string, action: "revoke" | "delete") => boolean;
  onRevokeInvite: (inviteId: string) => void;
  onDeleteInvite: (inviteId: string) => void;
};

export function AdminInviteSection({
  inviteVisibility,
  onInviteVisibilityChange,
  onCreateInvite,
  roles,
  createInvitePending,
  inviteStatsLoading,
  inviteStats,
  inviteLinksLoading,
  inviteLinksError,
  onRetryInviteLinks,
  inviteRows,
  inviteTotal,
  hasMoreInvites,
  loadingMoreInvites,
  onLoadMoreInvites,
  inviteSearch,
  onInviteSearchChange,
  isInviteInactive,
  isInviteActionPending,
  onRevokeInvite,
  onDeleteInvite,
}: AdminInviteSectionProps) {
  const { t } = useTranslation("admin");
  const confirm = useConfirmDialog();
  const { canManage: canManagePermission } = useEffectivePermissions();
  const isAdmin = canManagePermission(["admin.invite.manage"]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createdInviteCode, setCreatedInviteCode] = useState<string | null>(null);
  const [inviteMaxUses, setInviteMaxUses] = useState(10);
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState<string | null>(null);
  const inviteRoleOptions = useMemo(
    () => roles.map((role) => ({ value: role.id, label: role.name })),
    [roles],
  );
  const selectedInviteRole = inviteRoleOptions.find((role) => role.value === inviteRoleId) ?? null;
  const createdInviteUrl = createdInviteCode
    ? `${window.location.origin}/register/${createdInviteCode}`
    : null;

  const resetCreateForm = useCallback(() => {
    setInviteMaxUses(10);
    setInviteExpiresAt("");
    setInviteRoleId(null);
  }, []);
  const handleOpenCreateModal = useCallback(() => {
    resetCreateForm();
    setCreatedInviteCode(null);
    setCreateModalOpen(true);
  }, [resetCreateForm]);
  const handleCloseCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    setCreatedInviteCode(null);
    resetCreateForm();
  }, [resetCreateForm]);
  const handleCreateInvite = useCallback(() => {
    if (!inviteRoleId) return;
    onCreateInvite(
      { roleId: inviteRoleId, maxUses: inviteMaxUses, expiresAt: inviteExpiresAt },
      (invite) => setCreatedInviteCode(invite.code),
    );
  }, [inviteExpiresAt, inviteMaxUses, inviteRoleId, onCreateInvite]);
  const handleRevokeInvite = useCallback((row: InviteRow) => {
    if (isInviteActionPending(row.id, "revoke") || isInviteActionPending(row.id, "delete")) return;
    void (async () => {
      const confirmed = await confirm({
        title: t("confirm.revokeInvite.title"),
        description: t("confirm.revokeInvite.description"),
        confirmLabel: t("invite.revoke"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (confirmed) onRevokeInvite(row.id);
    })();
  }, [confirm, isInviteActionPending, onRevokeInvite, t]);
  const handleDeleteInvite = useCallback((row: InviteRow) => {
    if (isInviteActionPending(row.id, "revoke") || isInviteActionPending(row.id, "delete")) return;
    void (async () => {
      const confirmed = await confirm({
        title: t("confirm.deleteInvite.title"),
        description: t("confirm.deleteInvite.description"),
        confirmLabel: t("common:action.delete"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (confirmed) onDeleteInvite(row.id);
    })();
  }, [confirm, isInviteActionPending, onDeleteInvite, t]);

  return (
    <div className="admin-fill flex flex-col gap-3">
      <ContentFilterToolbar
        search={(
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon size={14} aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={t("invite.search")}
              aria-label={t("invite.search")}
              value={inviteSearch}
              onChange={(event) => onInviteSearchChange(event.currentTarget.value)}
            />
            {inviteSearch ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton aria-label={t("common:action.clear")} onClick={() => onInviteSearchChange("")} size="icon-xs">
                  <XIcon size={14} aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        )}
        filterControls={(
          <ContentFilterGroup label={t("invite.filter.status")}>
            <RadioGroup
              aria-label={t("invite.filter.status")}
              className="content-filter-toolbar__option-list content-filter-toolbar__option-list--columns"
              value={inviteVisibility}
              onValueChange={(value) => onInviteVisibilityChange(value as "active" | "expired" | "revoked")}
            >
              {[
                { value: "active", label: t("invite.segActive") },
                { value: "expired", label: t("invite.segExpired") },
                { value: "revoked", label: t("invite.segRevoked") },
              ].map((option) => (
                <ContentFilterOption key={option.value}>
                  <RadioGroupItem value={option.value} />
                  <span>{option.label}</span>
                </ContentFilterOption>
              ))}
            </RadioGroup>
          </ContentFilterGroup>
        )}
        actions={isAdmin ? (
          <Button size="sm" onClick={handleOpenCreateModal}>
            <PlusIcon size={16} data-icon="inline-start" />
            {t("invite.create")}
          </Button>
        ) : null}
        filterLabel={t("common:filter.toggle")}
        activeFilterCount={inviteVisibility === "active" ? 0 : 1}
        resetLabel={t("common:filter.reset")}
        onReset={() => onInviteVisibilityChange("active")}
      />

      {inviteStatsLoading ? (
        <div className="admin-panel admin-stats" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="admin-stat" key={index}>
              <Skeleton className="mb-1 h-7 w-[45%]" />
              <Skeleton className="h-3 w-[65%]" />
            </div>
          ))}
        </div>
      ) : inviteStats ? (
        <div className="admin-panel admin-stats">
          <InviteStatistic value={inviteStats.total} label={t("invite.stats.total")} />
          <InviteStatistic value={inviteStats.active} label={t("invite.stats.active")} className="admin-stat__value--ok" />
          <InviteStatistic
            value={inviteStats.expired}
            label={t("invite.stats.expired")}
            className={inviteStats.expired > 0 ? "admin-stat__value--warn" : undefined}
          />
          <InviteStatistic value={inviteStats.revoked} label={t("invite.stats.revoked")} />
        </div>
      ) : null}

      {inviteLinksLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[18px]" />)}
        </div>
      ) : null}
      {inviteLinksError ? <AdminLoadError onRetry={onRetryInviteLinks} /> : null}
      {!inviteLinksLoading && !inviteLinksError ? (
        <AdminInviteTable
          isAdmin={isAdmin}
          inviteRows={inviteRows}
          inviteTotal={inviteTotal}
          hasMoreInvites={hasMoreInvites}
          loadingMoreInvites={loadingMoreInvites}
          onLoadMoreInvites={onLoadMoreInvites}
          isInviteInactive={isInviteInactive}
          isInviteActionPending={isInviteActionPending}
          onRevokeInvite={handleRevokeInvite}
          onDeleteInvite={handleDeleteInvite}
        />
      ) : null}

      <Dialog open={createModalOpen} onOpenChange={(open) => { if (!open) handleCloseCreateModal(); }}>
        <DialogContent
          closeLabel={t("common:action.close")}
          onKeyDownCapture={(event) => {
            if (event.key === "Escape") handleCloseCreateModal();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("invite.createTitle")}</DialogTitle>
          </DialogHeader>
          {createdInviteUrl ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t("invite.createdCodeNotice")}</p>
              <InputGroup>
                <InputGroupInput aria-label={t("invite.createdLink")} readOnly value={createdInviteUrl} />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton onClick={() => { void copyPlainText(createdInviteUrl); }}>
                    {t("invite.copy")}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <div className="grid gap-1.5">
                <div className="grid gap-0.5">
                  <p className="text-sm font-medium text-foreground">{t("invite.createdCode")}</p>
                  <p className="text-xs text-muted-foreground">{t("invite.manualCodeHint")}</p>
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
                  <code
                    aria-label={t("invite.createdCode")}
                    className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-foreground"
                  >
                    {createdInviteCode}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { if (createdInviteCode) void copyPlainText(createdInviteCode); }}
                  >
                    {t("invite.copyCode")}
                  </Button>
                </div>
              </div>
              <Button className="w-full" onClick={handleCloseCreateModal}>{t("common:action.close")}</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
            <div className="grid gap-2">
              <Label htmlFor="admin-invite-role">{t("invite.role")}</Label>
              <Combobox.Root
                items={inviteRoleOptions}
                value={selectedInviteRole}
                onValueChange={(role) => setInviteRoleId(role?.value ?? null)}
              >
                <Combobox.Input
                  id="admin-invite-role"
                  aria-label={t("invite.aria.role")}
                  placeholder={t("invite.rolePlaceholder")}
                  required
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                />
                <Combobox.Portal>
                  <Combobox.Positioner side="bottom" align="start" sideOffset={4} className="isolate z-50">
                    <Combobox.Popup className="max-h-(--available-height) w-(--anchor-width) min-w-36 overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                      <Combobox.List className="grid gap-0.5">
                        {(role: { value: string; label: string }) => (
                          <Combobox.Item
                            key={role.value}
                            value={role}
                            className="flex cursor-default items-center rounded-md px-2 py-1 text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:bg-muted"
                          >
                            {role.label}
                          </Combobox.Item>
                        )}
                      </Combobox.List>
                    </Combobox.Popup>
                  </Combobox.Positioner>
                </Combobox.Portal>
              </Combobox.Root>
            </div>
            {/* 两个字段共用一个标签列。各自成行时标签宽度不同，输入框的左边缘会错开。 */}
            <div className="admin-invite-form__fields">
              <span className="text-sm text-muted-foreground">{t("invite.maxUses")}</span>
              <input
                type="number"
                min={1}
                value={inviteMaxUses}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  setInviteMaxUses(Number.isFinite(value) && value >= 1 ? value : 1);
                }}
                aria-label={t("invite.aria.maxUses")}
                className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              />
              <span className="text-sm text-muted-foreground">{t("invite.expiresAt")}</span>
              <NativeDateTimeInput
                type="datetime-local"
                value={inviteExpiresAt}
                onChange={(event) => setInviteExpiresAt(event.currentTarget.value)}
                aria-label={t("invite.aria.expiresAt")}
              />
            </div>
            <Button
              className="w-full"
              loading={createInvitePending}
              disabled={createInvitePending || !inviteRoleId}
              onClick={handleCreateInvite}
            >
              <PlusIcon size={16} data-icon="inline-start" />
              {t("invite.create")}
            </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InviteStatistic({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <div className="admin-stat">
      <div className={`admin-stat__value${className ? ` ${className}` : ""}`}>{value}</div>
      <div className="admin-stat__label">{label}</div>
    </div>
  );
}
