import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Textarea } from "@portal/components/ui/textarea";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export type GuildWarTeamEditTarget = {
  containerId: string;
  name: string;
  notes: string;
  locked: boolean;
};

type GuildWarTeamEditModalProps = {
  target: GuildWarTeamEditTarget | null;
  onNameChange: (containerId: string, value: string) => void;
  onNotesChange: (containerId: string, value: string) => void;
  onClose: () => void;
};

/*
 * 队名和备注在同一个弹窗里改。
 *
 * 只有关闭，没有取消：这块板子上的改动一律走草稿自动保存，摆一个「取消」等于承诺能撤回，
 * 而草稿模型撤不回来。
 */
export function GuildWarTeamEditModal({
  target,
  onNameChange,
  onNotesChange,
  onClose,
}: GuildWarTeamEditModalProps) {
  const { t } = useTranslation("guild-war");
  const nameId = useId();
  const notesId = useId();
  const notesDescriptionId = useId();

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("active.teamSetup.edit")}</DialogTitle>
        </DialogHeader>
        {target ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={nameId}>{t("active.teamSetup.namePlaceholder")}</Label>
              <Input
                id={nameId}
                value={target.name}
                onChange={(event) => onNameChange(target.containerId, event.currentTarget.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={notesId}>{t("active.teamSetup.notesPlaceholder")}</Label>
              {/* 锁住的队伍连备注也不给改，跟锁住之后拖不动是同一条规矩。 */}
              <Textarea
                id={notesId}
                aria-describedby={target.locked ? notesDescriptionId : undefined}
                value={target.notes}
                onChange={(event) => onNotesChange(target.containerId, event.currentTarget.value)}
                disabled={target.locked}
                rows={4}
              />
              {target.locked ? (
                <p id={notesDescriptionId} className="text-xs text-muted-foreground">
                  {t("active.teamSetup.locked")}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>{t("common:action.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
