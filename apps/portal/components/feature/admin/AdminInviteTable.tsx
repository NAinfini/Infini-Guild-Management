import type { InviteLink } from "@guild/shared";
import {
  AlertTriangleIcon,
  BanIcon,
  CircleCheckIcon,
  CircleXIcon,
  DotsIcon,
  InfoCircleIcon,
  TrashIcon,
} from "@portal/components/icons";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import {
  dataTableFeatures,
  type DataTableColumnDef,
} from "@portal/components/shared/data-table-features";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@portal/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import { IconLoader2 } from "@tabler/icons-react";
import { useTable } from "@tanstack/react-table";
import { useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/datetime";
import { resolveInviteStatus, type InviteStatus } from "../../../utils/invite-status";

type InviteRow = InviteLink;

type AdminInviteTableProps = {
  isAdmin: boolean;
  inviteRows: InviteRow[];
  inviteTotal: number;
  hasMoreInvites: boolean;
  loadingMoreInvites: boolean;
  onLoadMoreInvites: () => void;
  isInviteInactive: (row: InviteRow) => boolean;
  isInviteActionPending: (inviteId: string, action: "revoke" | "delete") => boolean;
  onRevokeInvite: (row: InviteRow) => void;
  onDeleteInvite: (row: InviteRow) => void;
};

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

export function AdminInviteTable({
  isAdmin,
  inviteRows,
  inviteTotal,
  hasMoreInvites,
  loadingMoreInvites,
  onLoadMoreInvites,
  isInviteInactive,
  isInviteActionPending,
  onRevokeInvite,
  onDeleteInvite,
}: AdminInviteTableProps) {
  const { t } = useTranslation("admin");
  const isCompactLayout = useMediaQuery("(max-width: 64em)");
  const columns = useMemo<DataTableColumnDef<InviteRow>[]>(() => {
    const cols: DataTableColumnDef<InviteRow>[] = [];

    cols.push({
      header: t("invite.table.code"),
      id: "code",
      accessorKey: "code",
      cell: ({ row }) => <code className="font-mono text-sm font-semibold">{row.original.code}</code>,
    });
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
          return (
            <div className="flex items-center justify-end gap-1.5">
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
                      <DropdownMenuItem disabled={inactive || destructivePending} onClick={() => onRevokeInvite(row.original)}>
                        {revokePending ? <IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <BanIcon size={14} />}
                        {t("invite.revoke")}
                      </DropdownMenuItem>
                    </TooltipTrigger>
                    <TooltipContent side="left">{inactiveReason}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuItem variant="destructive" disabled={destructivePending} onClick={() => onDeleteInvite(row.original)}>
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
  }, [isAdmin, isInviteActionPending, isInviteInactive, onDeleteInvite, onRevokeInvite, t]);

  const table = useTable({
    features: dataTableFeatures,
    data: inviteRows,
    columns,
    enableSorting: false,
    manualPagination: true,
    getRowId: (row) => row.id,
  });
  const inviteCountControls = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">
        {t("invite.loadedCount", { loaded: inviteRows.length, total: inviteTotal })}
      </span>
      {hasMoreInvites ? (
        <Button size="sm" variant="outline" loading={loadingMoreInvites} disabled={loadingMoreInvites} onClick={onLoadMoreInvites}>
          {t("invite.loadMore")}
        </Button>
      ) : null}
    </div>
  );

  if (!isCompactLayout) {
    return (
      <section className="admin-panel admin-table-card admin-table-card--fill">
        <div className="admin-table-card__scroll">
          <DataTableAdapter className="admin-table" table={table} appearance="rows" rowHover striped={false} />
        </div>
        <div className="admin-table-card__footer">{inviteCountControls}</div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="admin-invite-card-list">
        {inviteRows.map((row) => {
          const inactive = isInviteInactive(row);
          const revokePending = isInviteActionPending(row.id, "revoke");
          const deletePending = isInviteActionPending(row.id, "delete");
          const destructivePending = revokePending || deletePending;
          const inactiveReason = t(`invite.tooltip.${resolveInviteStatus(row)}`);
          return (
            <article key={row.id} className="admin-panel" aria-label={t("invite.cardAria")}>
              <div className="admin-invite-card-content">
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <InviteStatusBadge invite={row} />
                  </div>
                  <dl className="admin-invite-card__details">
                    <div><dt>{t("invite.table.code")}</dt><dd><code className="font-mono font-semibold">{row.code}</code></dd></div>
                    <div><dt>{t("invite.table.role")}</dt><dd><InviteRole invite={row} /></dd></div>
                    <div><dt>{t("invite.table.usage")}</dt><dd>{row.used_count}/{row.max_uses}</dd></div>
                    <div>
                      <dt>{t("invite.table.expires")}</dt>
                      <dd>{row.expires_at ? <time dateTime={row.expires_at}>{formatDateTime(row.expires_at)}</time> : formatDateTime(null)}</dd>
                    </div>
                    <div><dt>{t("invite.table.created")}</dt><dd><time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time></dd></div>
                  </dl>
                  {isAdmin ? (
                    <div className="admin-invite-card__actions">
                      <Tooltip disabled={!inactive}>
                        <TooltipTrigger render={<span data-disabled-tooltip-target={inactive || undefined} />}>
                          <Button className="w-full" size="lg" variant="outline" loading={revokePending} disabled={inactive || destructivePending} onClick={() => onRevokeInvite(row)}>
                            <BanIcon size={16} data-icon="inline-start" />
                            {t("invite.revoke")}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{inactiveReason}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger render={<span />}>
                          <Button className="w-full" size="lg" variant="destructive" loading={deletePending} disabled={destructivePending} onClick={() => onDeleteInvite(row)}>
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
  );
}
