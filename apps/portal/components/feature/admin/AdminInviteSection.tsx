import type { AdminRole, InviteLink } from "@guild/shared";
import { Combobox } from "@base-ui/react/combobox";
import { AlertTriangleIcon, BanIcon, CircleCheckIcon, CircleXIcon, CopyIcon, DotsIcon, InfoCircleIcon, PlusIcon, SearchIcon, TrashIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@portal/components/ui/input-group";
import { Label } from "@portal/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import { ContentFilterGroup, ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { NativeDateTimeInput } from "@portal/components/shared/NativeDateTimeInput";
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useEffectivePermissions } from "../../../hooks/useEffectivePermissions";
import { formatDateTime } from "../../../utils/datetime";
import { copyPlainText } from "../../../utils/copy";
import { resolveInviteStatus, type InviteStatus } from "../../../utils/invite-status";
import type { InviteLinkStatsSummary } from "../../../services/AdminService";
import { AdminLoadError } from "./AdminLoadError";

type InviteRow = InviteLink;
type InviteStats = InviteLinkStatsSummary;

function InviteRole({ invite }: { invite: InviteRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-full bg-(--role-color) ring-1 ring-foreground/10"
        style={{ "--role-color": invite.role_color ?? "var(--border-strong)" } as CSSProperties}
      />
      <span className="truncate text-sm">{invite.role_name}</span>
    </span>
  );
}

const INVITE_STATUS_PRESENTATION = {
  revoked: { variant: "destructive", iconClassName: "bg-destructive/10 text-destructive", Icon: AlertTriangleIcon },
  fullyUsed: { variant: "outline", iconClassName: "bg-muted text-foreground", Icon: CircleXIcon },
  expired: { variant: "outline", iconClassName: "bg-muted text-foreground", Icon: InfoCircleIcon },
  active: { variant: "default", iconClassName: "bg-primary/15 text-primary", Icon: CircleCheckIcon },
} as const satisfies Record<InviteStatus, {
  variant: "default" | "outline" | "destructive";
  iconClassName: string;
  Icon: typeof AlertTriangleIcon;
}>;

function InviteStatusBadge({ invite }: { invite: InviteRow }) {
  const { t } = useTranslation("admin");
  const status = resolveInviteStatus(invite);
  const { variant, iconClassName, Icon } = INVITE_STATUS_PRESENTATION[status];
  const label = t(`invite.status.${status}`);

  return (
    <Tooltip>
      <TooltipTrigger render={<Badge data-animate-icon-trigger variant={variant} />}>
        {label}
      </TooltipTrigger>
      <TooltipContent className="admin-invite-status-popover max-w-[16.25rem] whitespace-normal">
        <div className="flex items-start gap-2.5">
          <span className={`admin-invite-status-icon inline-flex size-8 shrink-0 items-center justify-center rounded-md ${iconClassName}`}>
            <Icon size={16} />
          </span>
          <div className="admin-invite-status-copy">
            <strong className="block text-sm leading-snug">{label}</strong>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {t(`invite.tooltip.${status}`)}
            </span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

type AdminInviteSectionProps = {
  inviteVisibility: "active" | "expired" | "revoked";
  onInviteVisibilityChange: (value: "active" | "expired" | "revoked") => void;
  onCreateInvite: (
    input: { roleId: string; maxUses: number; expiresAt: string },
    onSuccess: () => void,
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
  const isCompactLayout = useMediaQuery("(max-width: 64em)");
  const [inviteMaxUses, setInviteMaxUses] = useState(10);
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState<string | null>(null);
  const inviteRoleOptions = useMemo(
    () => roles.map((role) => ({ value: role.id, label: role.name })),
    [roles],
  );
  const selectedInviteRole = inviteRoleOptions.find((role) => role.value === inviteRoleId) ?? null;

  const resetCreateForm = useCallback(() => {
    setInviteMaxUses(10);
    setInviteExpiresAt("");
    setInviteRoleId(null);
  }, []);
  const handleOpenCreateModal = useCallback(() => {
    resetCreateForm();
    setCreateModalOpen(true);
  }, [resetCreateForm]);
  const handleCloseCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    resetCreateForm();
  }, [resetCreateForm]);
  const handleCreateInvite = useCallback(() => {
    if (!inviteRoleId) {
      return;
    }
    onCreateInvite(
      { roleId: inviteRoleId, maxUses: inviteMaxUses, expiresAt: inviteExpiresAt },
      handleCloseCreateModal,
    );
  }, [handleCloseCreateModal, inviteExpiresAt, inviteMaxUses, inviteRoleId, onCreateInvite]);

  const handleCopyInviteLink = useCallback((row: InviteRow) => {
    void copyPlainText(`${window.location.origin}/register/${row.code}`);
  }, []);

  const handleRevokeInvite = useCallback((row: InviteRow) => {
    if (isInviteActionPending(row.id, "revoke") || isInviteActionPending(row.id, "delete")) {
      return;
    }
    void (async () => {
      const confirmed = await confirm({
        title: t("confirm.revokeInvite.title"),
        description: t("confirm.revokeInvite.description", { code: row.code }),
        confirmLabel: t("invite.revoke"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (!confirmed) {
        return;
      }
      onRevokeInvite(row.id);
    })();
  }, [confirm, isInviteActionPending, onRevokeInvite, t]);

  const handleDeleteInvite = useCallback((row: InviteRow) => {
    if (isInviteActionPending(row.id, "revoke") || isInviteActionPending(row.id, "delete")) {
      return;
    }
    void (async () => {
      const confirmed = await confirm({
        title: t("confirm.deleteInvite.title"),
        description: t("confirm.deleteInvite.description", { code: row.code }),
        confirmLabel: t("common:action.delete"),
        cancelLabel: t("common:action.cancel"),
        intent: "danger",
      });
      if (!confirmed) {
        return;
      }
      onDeleteInvite(row.id);
    })();
  }, [confirm, isInviteActionPending, onDeleteInvite, t]);

  const columns = useMemo<ColumnDef<InviteRow, unknown>[]>(() => {
    const cols: ColumnDef<InviteRow, unknown>[] = [];

    if (isAdmin) {
      cols.push({
        header: t("invite.table.code"),
        id: "code",
        accessorKey: "code",
      });
    }

    cols.push({
      header: t("invite.table.role"),
      id: "role",
      accessorFn: (row) => row.role_name,
      cell: ({ row }) => <InviteRole invite={row.original} />,
    });

    cols.push({
      header: t("invite.table.usage"),
      id: "usage",
      accessorFn: (row) => row.used_count / Math.max(row.max_uses, 1),
      /* 「还剩几次能用」是这张表最该一眼看懂的东西，光给个分数看不出程度。 */
      cell: ({ row }) => {
        const used = row.original.used_count;
        const max = row.original.max_uses;
        const ratio = max > 0 ? Math.min(100, (used / max) * 100) : 0;
        return (
          <span className="admin-invite-usage">
            <span className="admin-invite-usage__track">
              <span
                className={`admin-invite-usage__fill${ratio >= 100 ? " admin-invite-usage__fill--full" : ""}`}
                style={{ width: `${ratio}%` }}
              />
            </span>
            <span className="admin-invite-usage__value">{used}/{max}</span>
          </span>
        );
      },
    });

    cols.push({
      header: t("invite.table.status"),
      id: "status",
      enableSorting: false,
      cell: ({ row }) => <InviteStatusBadge invite={row.original} />,
    });

    cols.push(
      {
        header: t("invite.table.expires"),
        id: "expires",
        accessorFn: (row) => row.expires_at ?? "",
        cell: ({ row }) => formatDateTime(row.original.expires_at),
      },
      {
        header: t("invite.table.created"),
        id: "created",
        accessorFn: (row) => row.created_at ?? "",
        cell: ({ row }) => formatDateTime(row.original.created_at),
      },
    );

    if (isAdmin) {
      cols.push({
        header: t("invite.table.actions"),
        id: "actions",
        enableSorting: false,
        cell: ({ row }) => {
          const inactive = isInviteInactive(row.original);
          const revokePending = isInviteActionPending(row.original.id, "revoke");
          const deletePending = isInviteActionPending(row.original.id, "delete");
          const destructivePending = revokePending || deletePending;
          const inactiveReason = t(`invite.tooltip.${resolveInviteStatus(row.original)}`);
          // Keep the frequent copy action visible; destructive actions stay in the row menu.
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Tooltip disabled={!inactive}>
                <TooltipTrigger render={<span data-disabled-tooltip-target={inactive || undefined} />}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopyInviteLink(row.original)}
                    disabled={inactive}
                  >
                    <CopyIcon size={14} data-icon="inline-start" />
                    {t("invite.copy")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{inactiveReason}</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger render={(
                  <Button variant="ghost" size="icon-sm" aria-label={t("invite.table.actions")} />
                )}>
                  <DotsIcon size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-45">
                  {/* 收进菜单之后同样要说清「为什么点不了」，不能只把它置灰。 */}
                  <Tooltip disabled={!inactive}>
                    <TooltipTrigger render={<span data-disabled-tooltip-target={inactive || undefined} />}>
                      <DropdownMenuItem
                        disabled={inactive || destructivePending}
                        onClick={() => handleRevokeInvite(row.original)}
                      >
                        {revokePending ? <IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <BanIcon size={14} />}
                        {t("invite.revoke")}
                      </DropdownMenuItem>
                    </TooltipTrigger>
                    <TooltipContent side="left">{inactiveReason}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={destructivePending}
                    onClick={() => handleDeleteInvite(row.original)}
                  >
                    {deletePending ? <IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <TrashIcon size={14} />}
                    {t("invite.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      });
    }

    return cols;
   
  }, [
    handleCopyInviteLink,
    handleDeleteInvite,
    handleRevokeInvite,
    isAdmin,
    isInviteActionPending,
    isInviteInactive,
    t,
  ]);

  const table = useReactTable({
    data: inviteRows,
    columns,
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  const inviteCountControls = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">
        {t("invite.loadedCount", {
          loaded: inviteRows.length,
          total: inviteTotal,
        })}
      </span>
      {hasMoreInvites ? (
        <Button
          size="sm"
          variant="outline"
          loading={loadingMoreInvites}
          disabled={loadingMoreInvites}
          onClick={onLoadMoreInvites}
        >
          {t("invite.loadMore")}
        </Button>
      ) : null}
    </div>
  );

  return (
    /* admin-fill：把 .admin-page__panel 给的高度原样传给下面的表格卡片。 */
    <div className="admin-fill flex flex-col gap-3">
      <ContentFilterToolbar
        search={(
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon size={14} aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={t(isAdmin ? "invite.search" : "invite.searchDateOnly")}
              aria-label={t(isAdmin ? "invite.search" : "invite.searchDateOnly")}
              value={inviteSearch}
              onChange={(event) => onInviteSearchChange(event.currentTarget.value)}
            />
          </InputGroup>
        )}
        filterControls={(
          <ContentFilterGroup label={t("invite.filter.status")}>
            <RadioGroup
              className="grid grid-cols-3 gap-2"
              value={inviteVisibility}
              onValueChange={(value) => onInviteVisibilityChange(value as "active" | "expired" | "revoked")}
            >
              {[
                { value: "active", label: t("invite.segActive") },
                { value: "expired", label: t("invite.segExpired") },
                { value: "revoked", label: t("invite.segRevoked") },
              ].map((option) => (
                <Label key={option.value} className="flex min-h-7 items-center gap-1.5 rounded-md border border-input px-2 text-sm">
                  <RadioGroupItem value={option.value} />
                  <span className="min-w-0 truncate">{option.label}</span>
                </Label>
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
          <div className="admin-stat">
            <div className="admin-stat__value">{inviteStats.total}</div>
            <div className="admin-stat__label">{t("invite.stats.total")}</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat__value admin-stat__value--ok">{inviteStats.active}</div>
            <div className="admin-stat__label">{t("invite.stats.active")}</div>
          </div>
          <div className="admin-stat">
            <div className={`admin-stat__value${inviteStats.expired > 0 ? " admin-stat__value--warn" : ""}`}>
              {inviteStats.expired}
            </div>
            <div className="admin-stat__label">{t("invite.stats.expired")}</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat__value">{inviteStats.revoked}</div>
            <div className="admin-stat__label">{t("invite.stats.revoked")}</div>
          </div>
        </div>
      ) : null}

      {/* Table */}
      {inviteLinksLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[18px]" />)}
        </div>
      ) : null}
      {inviteLinksError ? <AdminLoadError onRetry={onRetryInviteLinks} /> : null}
      {!inviteLinksLoading && !inviteLinksError ? (
        isCompactLayout ? (
          <div className="flex flex-col gap-4">
            <div className="admin-invite-card-list">
              {inviteRows.map((row) => {
                const inactive = isInviteInactive(row);
                const revokePending = isInviteActionPending(row.id, "revoke");
                const deletePending = isInviteActionPending(row.id, "delete");
                const destructivePending = revokePending || deletePending;
                const inactiveReason = t(`invite.tooltip.${resolveInviteStatus(row)}`);
                return (
                  <article
                    key={row.id}
                    className="admin-panel"
                    aria-label={t("invite.cardAria")}
                  >
                    <div className="admin-invite-card-content">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-start justify-between gap-3">
                          {isAdmin ? (
                            <div className="admin-invite-card__code-block">
                              <span className="text-xs text-muted-foreground">{t("invite.table.code")}</span>
                              <code className="admin-invite-card__code">
                                {row.code}
                              </code>
                            </div>
                          ) : null}
                          <InviteStatusBadge invite={row} />
                        </div>

                        <dl className="admin-invite-card__details">
                          <div>
                            <dt>{t("invite.table.role")}</dt>
                            <dd><InviteRole invite={row} /></dd>
                          </div>
                          <div>
                            <dt>{t("invite.table.usage")}</dt>
                            <dd>{row.used_count}/{row.max_uses}</dd>
                          </div>
                          <div>
                            <dt>{t("invite.table.expires")}</dt>
                            <dd>
                              {row.expires_at ? (
                                <time dateTime={row.expires_at}>{formatDateTime(row.expires_at)}</time>
                              ) : formatDateTime(null)}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("invite.table.created")}</dt>
                            <dd><time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time></dd>
                          </div>
                        </dl>

                        {isAdmin ? (
                          <div className="admin-invite-card__actions">
                            <Tooltip disabled={!inactive}>
                              <TooltipTrigger render={<span data-disabled-tooltip-target={inactive || undefined} />}>
                                <Button
                                  className="w-full"
                                  size="lg"
                                  variant="outline"
                                  onClick={() => handleCopyInviteLink(row)}
                                  disabled={inactive}
                                >
                                  <CopyIcon size={16} data-icon="inline-start" />
                                  {t("invite.copy")}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{inactiveReason}</TooltipContent>
                            </Tooltip>
                            <Tooltip disabled={!inactive}>
                              <TooltipTrigger render={<span data-disabled-tooltip-target={inactive || undefined} />}>
                                <Button
                                  className="w-full"
                                  size="lg"
                                  variant="outline"
                                  loading={revokePending}
                                  disabled={inactive || destructivePending}
                                  onClick={() => handleRevokeInvite(row)}
                                >
                                  <BanIcon size={16} data-icon="inline-start" />
                                  {t("invite.revoke")}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{inactiveReason}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={<span />}>
                                <Button
                                  className="w-full"
                                  size="lg"
                                  variant="destructive"
                                  loading={deletePending}
                                  disabled={destructivePending}
                                  onClick={() => handleDeleteInvite(row)}
                                >
                                  <TrashIcon size={16} data-icon="inline-start" />
                                  {t("invite.delete")}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t("invite.delete")}</TooltipContent>
                            </Tooltip>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {inviteCountControls}
          </div>
        ) : (
          <section className="admin-panel admin-table-card admin-table-card--fill">
            <div className="admin-table-card__scroll">
              <DataTableAdapter
                className="admin-table"
                table={table}
                appearance="rows"
                rowHover
                striped={false}
              />
            </div>
            <div className="admin-table-card__footer">{inviteCountControls}</div>
          </section>
        )
      ) : null}

      {/* Create Invite Modal */}
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
