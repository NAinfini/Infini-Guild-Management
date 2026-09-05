import { identityNameSchema, type AdminRole } from "@guild/shared";
import { CheckIcon, CopyIcon, UserPlusIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { Textarea } from "@portal/components/ui/textarea";
import { copyPlainText } from "@portal/utils/copy";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "../../../utils/notifications";
import "./CreateMemberModal.css";

type CreateMemberResult = {
  user_id: string;
  display_name: string;
  temporary_login_name: string;
  temporary_password: string;
};

type CreateMemberModalProps = {
  opened: boolean;
  onClose: () => void;
  onCreateMember: (data: {
    login_name: string;
    display_name: string;
    notes: string;
    roleId: string;
  }) => Promise<CreateMemberResult>;
  creating: boolean;
  roles: AdminRole[];
};

function CredentialField({
  label,
  value,
  copyLabel,
  copiedLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const inputId = useId();
  return (
    <div className="create-member-modal__field">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="create-member-modal__credential-row">
        <Input id={inputId} className="create-member-modal__credential" value={value} readOnly />
        <Button
          type="button"
          size="sm"
          variant={copied ? "secondary" : "outline"}
          onClick={() => {
            void copyPlainText(value).then(() => setCopied(true));
          }}
        >
          {copied ? <CheckIcon size={16} data-icon="inline-start" /> : <CopyIcon size={16} data-icon="inline-start" />}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </div>
  );
}

export function CreateMemberModal({
  opened,
  onClose,
  onCreateMember,
  creating,
  roles,
}: CreateMemberModalProps) {
  const { t } = useTranslation("admin");
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [roleId, setRoleId] = useState("");
  const [result, setResult] = useState<CreateMemberResult | null>(null);
  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }));
  const hasAssignableRole = roles.some((role) => role.id === roleId);

  const resetForm = () => {
    setLoginName("");
    setDisplayName("");
    setNotes("");
    setRoleId("");
    setResult(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreate = async () => {
    const trimmedLoginName = loginName.trim();
    const trimmedDisplayName = displayName.trim();
    if (!trimmedLoginName || !trimmedDisplayName || !hasAssignableRole) return;
    if (!identityNameSchema.safeParse(trimmedLoginName).success
      || !identityNameSchema.safeParse(trimmedDisplayName).success) {
      notifyError(t("member.create.nameInvalid"));
      return;
    }

    try {
      const nextResult = await onCreateMember({
        login_name: trimmedLoginName,
        display_name: trimmedDisplayName,
        notes: notes.trim(),
        roleId,
      });
      setResult(nextResult);
    } catch {
      // The controller owns mutation error notifications.
    }
  };

  return (
    <Dialog open={opened} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="create-member-modal" closeLabel={t("member.create.cancel")}>
        <DialogHeader>
          <DialogTitle>{t("member.create.modalTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {result
              ? t("member.create.temporaryCredentialsNotice")
              : t("member.create.modalTitle")}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="create-member-modal__stack">
            <p className="create-member-modal__success">
              {t("member.create.successMessage", { display_name: result.display_name })}
            </p>
            <p className="create-member-modal__notice">{t("member.create.temporaryCredentialsNotice")}</p>
            <CredentialField
              label={t("member.create.temporaryLoginName")}
              value={result.temporary_login_name}
              copyLabel={t("member.create.copy")}
              copiedLabel={t("member.create.copied")}
            />
            <CredentialField
              label={t("member.create.temporaryPassword")}
              value={result.temporary_password}
              copyLabel={t("member.create.copy")}
              copiedLabel={t("member.create.copied")}
            />
            <div className="create-member-modal__actions">
              <Button type="button" size="sm" onClick={handleClose}>
                {t("member.create.done")}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="create-member-modal__stack"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <div className="create-member-modal__field">
              <Label htmlFor="create-member-login">{t("member.create.loginNameLabel")}</Label>
              <Input
                id="create-member-login"
                placeholder={t("member.create.loginNamePlaceholder")}
                value={loginName}
                onChange={(event) => setLoginName(event.currentTarget.value)}
                required
                autoFocus
              />
            </div>
            <div className="create-member-modal__field">
              <Label htmlFor="create-member-display">{t("member.create.displayNameLabel")}</Label>
              <Input
                id="create-member-display"
                placeholder={t("member.create.displayNamePlaceholder")}
                value={displayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                required
              />
            </div>
            <div className="create-member-modal__field">
              <Label htmlFor="create-member-role">{t("member.create.roleLabel")}</Label>
              <Select
                value={roleId || null}
                items={roleOptions}
                onValueChange={(value) => setRoleId(value ?? "")}
              >
                <SelectTrigger id="create-member-role" className="create-member-modal__select">
                  <SelectValue placeholder={t("member.create.rolePlaceholder")} />
                </SelectTrigger>
                <SelectContent align="start">
                  {roleOptions.map((role) => (
                    <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="create-member-modal__field">
              <Label htmlFor="create-member-notes">{t("member.create.notesLabel")}</Label>
              <Textarea
                id="create-member-notes"
                placeholder={t("member.create.notesPlaceholder")}
                value={notes}
                onChange={(event) => setNotes(event.currentTarget.value)}
                rows={3}
              />
            </div>
            <div className="create-member-modal__actions">
              <Button type="button" onClick={handleClose} variant="outline" size="sm">
                {t("member.create.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!loginName.trim() || !displayName.trim() || !hasAssignableRole || creating}
                loading={creating}
              >
                <UserPlusIcon size={16} data-icon="inline-start" />
                {t("member.create.submit")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
