import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import type { MemberDirectoryLoadError } from "@portal/hooks/data/useMemberDirectory";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { PickList } from "../../shared/PickList";
import { RetryableLoadError } from "../../shared/RetryableLoadError";

type PoolMemberOption = {
  value: string;
  label: string;
};

type GuildWarAddToPoolDialogProps = {
  open: boolean;
  pending: boolean;
  availableCount: number;
  options: readonly PoolMemberOption[];
  selectedUserIds: readonly string[];
  search: string;
  onOpenChange: (open: boolean) => void;
  onToggleUser: (userId: string) => void;
  onSearchChange: (value: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  membersLoading?: boolean;
  memberLoadError?: MemberDirectoryLoadError | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function GuildWarAddToPoolDialog({
  open,
  pending,
  availableCount,
  options,
  selectedUserIds,
  search,
  onOpenChange,
  onToggleUser,
  onSearchChange,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  membersLoading = false,
  memberLoadError = null,
  onCancel,
  onConfirm,
}: GuildWarAddToPoolDialogProps) {
  const { t } = useTranslation("guild-war");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="guild-war-task-modal"
        closeLabel={t("common:action.close")}
        closeButtonDisabled={pending}
      >
        <DialogHeader>
          <DialogTitle>{t("active.addToPoolTitle")}</DialogTitle>
          <DialogDescription>{t("active.addToPoolDescription")}</DialogDescription>
        </DialogHeader>
        <div className="guild-war-task-modal__body">
          <div className="guild-war-task-modal__intro">
            <span>{t("active.addToPoolField")}</span>
            {!membersLoading && !(memberLoadError && options.length === 0) ? (
              <Badge variant="secondary" className="tabular-nums">
                {t("active.addToPoolAvailable", { count: availableCount })}
              </Badge>
            ) : null}
          </div>
          {memberLoadError ? (
            <RetryableLoadError
              pending={memberLoadError.retrying}
              onRetry={() => { void memberLoadError.retry(); }}
            />
          ) : null}
          {membersLoading && options.length === 0 ? (
            <LoadingIndicator />
          ) : memberLoadError && options.length === 0 ? null : (
            <PickList
              className="guild-war-task-modal__pick-list"
              options={options.map((option) => ({
                id: option.value,
                label: option.label,
              }))}
              selected={new Set(selectedUserIds)}
              onToggle={onToggleUser}
              search={{
                value: search,
                onChange: onSearchChange,
                placeholder: t("active.addToPoolPlaceholder"),
              }}
              emptyLabel={t("empty")}
              aria-label={t("active.addToPoolField")}
            />
          )}
          {hasMore && onLoadMore && !memberLoadError ? (
            <Button variant="ghost" loading={loadingMore} onClick={onLoadMore}>
              {t("common:action.loadMore")}
            </Button>
          ) : null}
        </div>
        <DialogFooter className="guild-war-task-modal__footer">
          <span className="guild-war-task-modal__selection tabular-nums">
            {t("active.addToPoolSelected", { count: selectedUserIds.length })}
          </span>
          <Button autoFocus variant="outline" onClick={onCancel} disabled={pending}>
            {t("common:action.cancel")}
          </Button>
          <Button
            onClick={onConfirm}
            loading={pending}
            disabled={selectedUserIds.length === 0 || pending}
          >
            {t("active.addToPoolConfirm", { count: selectedUserIds.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
