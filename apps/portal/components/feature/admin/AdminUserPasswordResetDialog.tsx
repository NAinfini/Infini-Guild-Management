import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Label } from "@portal/components/ui/label";
import { PasswordInput } from "@portal/components/ui/password-input";
import { useTranslation } from "react-i18next";

type AdminUserPasswordResetDialogProps = {
  open: boolean;
  currentPassword: string;
  pending: boolean;
  onCurrentPasswordChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
};

export function AdminUserPasswordResetDialog({
  open,
  currentPassword,
  pending,
  onCurrentPasswordChange,
  onSubmit,
  onClose,
}: AdminUserPasswordResetDialogProps) {
  const { t } = useTranslation(["admin", "auth"]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent closeLabel={t("common:action.close")}>
        <DialogHeader>
          <DialogTitle>{t("member.resetPassword.confirmTitle")}</DialogTitle>
          <DialogDescription>{t("member.resetPassword.confirmDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="admin-users__password-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <div className="admin-users__password-field">
            <Label htmlFor="admin-user-current-password">{t("member.resetPassword.currentPasswordLabel")}</Label>
            <PasswordInput
              id="admin-user-current-password"
              value={currentPassword}
              onChange={(event) => onCurrentPasswordChange(event.currentTarget.value)}
              autoComplete="current-password"
              autoFocus
              required
              showPasswordLabel={t("auth:aria.showPassword")}
              hidePasswordLabel={t("auth:aria.hidePassword")}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("member.resetPassword.cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={!currentPassword || pending}>
              {t("member.resetPassword.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
