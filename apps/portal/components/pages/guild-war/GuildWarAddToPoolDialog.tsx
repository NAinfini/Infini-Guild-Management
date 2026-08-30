import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
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
            <Badge variant="secondary" className="tabular-nums">
              {t("active.addToPoolAvailable", { count: availableCount })}
            </Badge>
          </div>
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
