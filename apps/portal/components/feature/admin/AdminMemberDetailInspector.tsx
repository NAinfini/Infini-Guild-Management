import type { AdminRole } from "@guild/shared";
import { ChevronDownIcon, SaveIcon, XIcon } from "@portal/components/icons";
import { PickList } from "@portal/components/shared/PickList";
import { isOnVacation } from "@portal/components/shared/MemberCard";
import { ProfileOverviewCard } from "@portal/components/shared/ProfileOverviewCard";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card, CardContent } from "@portal/components/ui/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@portal/components/ui/drawer";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@portal/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { Switch } from "@portal/components/ui/switch";
import { Textarea } from "@portal/components/ui/textarea";
import { useClassCatalog } from "@portal/hooks/data/useClassData";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@portal/components/ui/sheet";
import { useAuthStore } from "@portal/stores/auth";
import type { AdminUserRow, MemberDetailFormState } from "@portal/types/admin";
import { buildClassOptions, resolveClassCatalogItem } from "@portal/utils/class-catalog";
import { formatCalendarDate } from "@portal/utils/datetime";
import { canManageUserByRoleLevel } from "@portal/utils/permissions";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AbsenceManagerCard } from "../../shared/AbsenceManagerCard";
import { TitleField } from "../../shared/TitleField";
import styles from "./AdminMemberDetailInspector.module.css";

type DetailView = "read" | "edit";

type AdminMemberDetailInspectorProps = {
  open: boolean;
  member: AdminUserRow | null;
  form: MemberDetailFormState;
  isDirty: boolean;
  onClose: () => void;
  onFormChange: (patch: Partial<MemberDetailFormState>) => void;
  onResetForm: () => void;
  onSaveProfile: (member: AdminUserRow) => void;
  saveProfilePending: boolean;
  mediaTab: ReactNode;
  roles: AdminRole[];
  canEditProfile: boolean;
  canAssignRole: boolean;
  canActivate: boolean;
};

function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className={styles.section}>
      <CardContent className={styles.sectionBody}>
        <div className={styles.sectionHeader}>
          <strong className={styles.sectionTitle}>{title}</strong>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function ReadonlyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {typeof children === "string" ? <strong className={styles.readonlyValue}>{children}</strong> : children}
    </div>
  );
}

function ClassMultiPicker({
  label,
  placeholder,
  emptyLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  emptyLabel: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const selected = new Set(value);
  const query = search.trim().toLowerCase();
  const visibleOptions = options.filter((option) => query === "" || option.label.toLowerCase().includes(query));
  const summary = value.length === 0
    ? placeholder
    : value.map((id) => options.find((option) => option.value === id)?.label ?? id).join(" · ");

  return (
    <div className={styles.field}>
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger render={<Button
          type="button"
          variant="outline"
          className={styles.classTrigger}
          aria-label={label}
        />}>
          <span>{summary}</span>
          <ChevronDownIcon size={14} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className={styles.classPopover} side="bottom" align="start">
          <PickList
            aria-label={label}
            options={visibleOptions.map((option) => ({ id: option.value, label: option.label }))}
            selected={selected}
            onToggle={(id) => onChange(selected.has(id) ? value.filter((entry) => entry !== id) : [...value, id])}
            emptyLabel={emptyLabel}
            search={{ value: search, onChange: setSearch, placeholder }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function AdminMemberDetailInspector({
  open,
  member,
  form,
  isDirty,
  onClose,
  onFormChange,
  onResetForm,
  onSaveProfile,
  saveProfilePending,
  mediaTab,
  roles,
  canEditProfile,
  canAssignRole,
  canActivate,
}: AdminMemberDetailInspectorProps) {
  const { t, i18n } = useTranslation("admin");
  const confirm = useConfirmDialog();
  const classCatalog = useClassCatalog();
  const currentUser = useAuthStore((state) => state.user);
  const classOptions = buildClassOptions(classCatalog);
  const canManageTarget = Boolean(member && canManageUserByRoleLevel(member.user, currentUser));
  const canEditMember = canManageTarget && canEditProfile;
  const canAssignMemberRole = canManageTarget && canAssignRole;
  const canActivateMember = canManageTarget && canActivate;
  const canSaveMember = canEditMember || canAssignMemberRole || canActivateMember;
  const selectedRoleIsAssignable = roles.some((role) => role.id === form.role);
  const [view, setView] = useState<DetailView>("read");
  const isMobile = useMediaQuery("(max-width: 47.99em)");
  const editing = view === "edit";

  const memberId = member?.user.id ?? null;
  useEffect(() => {
    setView("read");
  }, [memberId]);

  const handleCancelEdit = async () => {
    if (isDirty) {
      const confirmed = await confirm({
        title: t("common:unsavedChanges.title"),
        description: t("common:unsavedChanges.message"),
        confirmLabel: t("common:action.discard"),
        cancelLabel: t("common:unsavedChanges.stay"),
        intent: "warning",
      });
      if (!confirmed) return;
      onResetForm();
    }
    setView("read");
  };

  const handleSave = () => {
    if (!member) return;
    onSaveProfile(member);
    setView("read");
  };

  const renderBody = (target: AdminUserRow) => {
    const formatDay = (value: string) => formatCalendarDate(value, i18n.language, "numeric");
    const absenceSummary = isOnVacation(target.profile) && target.profile.vacation_start && target.profile.vacation_end
      ? t("detail.absence.active", {
        start: formatDay(target.profile.vacation_start),
        end: formatDay(target.profile.vacation_end),
      })
      : t("detail.absence.none");
    const mediaSummary = t("detail.media.summary", {
      images: target.profile.images.length,
      videos: target.profile.video_urls.length,
      audio: target.profile.audio_media_id
        ? t("detail.media.audioPresent")
        : t("detail.media.audioAbsent"),
    });

    return (
      <div className={styles.body}>
        <ProfileOverviewCard
          user={target.user}
          profile={target.profile}
          badges={target.badges}
          power={editing ? form.power : target.profile.power}
          titleHtml={editing ? form.titleHtml : target.profile.title_html ?? ""}
          classList={editing ? form.classes : target.profile.classes}
          imageList={target.profile.images}
          videoList={target.profile.video_urls}
          availabilityData={target.profile.availability}
        />

        {editing ? (
          <>
            <DetailSection title={t("detail.section.identity")}>
              <div className={styles.fieldGrid}>
                {canAssignMemberRole ? (
                  <div className={styles.field}>
                    <Label htmlFor="admin-member-role">{t("detail.field.role")}</Label>
                    <Select
                      value={selectedRoleIsAssignable ? form.role : null}
                      items={roles.map((role) => ({ value: role.id, label: role.name }))}
                      onValueChange={(value) => { if (value) onFormChange({ role: value }); }}
                    >
                      <SelectTrigger id="admin-member-role" className={styles.selectTrigger}>
                        <SelectValue placeholder={target.user.role_name} />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {roles.slice().sort((a, b) => a.level - b.level).map((role) => (
                          <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <ReadonlyField label={t("detail.field.role")}>{target.user.role_name}</ReadonlyField>
                )}

                {canActivateMember ? (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>{t("detail.field.status")}</span>
                    <div className={styles.inlineControl}>
                      <Switch
                        checked={form.isActive}
                        onCheckedChange={(checked) => onFormChange({ isActive: checked })}
                        size="sm"
                        aria-label={t("detail.field.status")}
                      />
                      <Badge variant={form.isActive ? "default" : "destructive"} data-state={form.isActive ? "active" : "inactive"}>
                        {form.isActive ? t("member.status.active") : t("member.status.inactive")}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <ReadonlyField label={t("detail.field.status")}>
                    <Badge
                      variant={target.user.is_active ? "default" : "destructive"}
                      data-state={target.user.is_active ? "active" : "inactive"}
                    >
                      {target.user.is_active ? t("member.status.active") : t("member.status.inactive")}
                    </Badge>
                  </ReadonlyField>
                )}
              </div>
            </DetailSection>

            <DetailSection title={t("detail.section.combat")}>
              {canEditMember ? (
                <div className={styles.fieldGrid}>
                  <div className={styles.field}>
                    <Label htmlFor="admin-member-power">{t("detail.field.power")}</Label>
                    <Input
                      id="admin-member-power"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder={t("detail.placeholder.power")}
                      value={form.power}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (Number.isFinite(value)) onFormChange({ power: value });
                      }}
                    />
                  </div>
                  <ClassMultiPicker
                    label={t("detail.field.classes")}
                    placeholder={t("detail.placeholder.classes")}
                    emptyLabel={t("detail.empty.classes")}
                    options={classOptions}
                    value={form.classes}
                    onChange={(classes) => onFormChange({ classes })}
                  />
                </div>
              ) : (
                <div className={styles.fieldGrid}>
                  <ReadonlyField label={t("detail.field.power")}>
                    {target.profile.power.toLocaleString()}
                  </ReadonlyField>
                  <ReadonlyField label={t("detail.field.classes")}>
                    {target.profile.classes.length > 0
                      ? target.profile.classes
                        .map((id) => resolveClassCatalogItem(id, classCatalog).label)
                        .join(" · ")
                      : t("detail.empty.classes")}
                  </ReadonlyField>
                </div>
              )}
            </DetailSection>

            <DetailSection title={t("detail.section.profile")}>
              {canEditMember ? (
                <div className={styles.stack}>
                  <TitleField
                    value={form.titleHtml}
                    onChange={(value) => onFormChange({ titleHtml: value })}
                  />
                  <div className={styles.field}>
                    <Label htmlFor="admin-member-bio">{t("detail.field.bio")}</Label>
                    <Textarea
                      id="admin-member-bio"
                      placeholder={t("detail.placeholder.bio")}
                      value={form.bio}
                      onChange={(event) => onFormChange({ bio: event.currentTarget.value })}
                      rows={3}
                    />
                  </div>
                </div>
              ) : (
                <ReadonlyField label={t("detail.field.bio")}>
                  {target.profile.bio?.trim() || t("detail.empty.bio")}
                </ReadonlyField>
              )}
            </DetailSection>

            <DetailSection title={t("detail.section.notes")}>
              {canEditMember ? (
                <Textarea
                  placeholder={t("detail.placeholder.notes")}
                  value={form.notes}
                  onChange={(event) => onFormChange({ notes: event.currentTarget.value })}
                  rows={3}
                  aria-label={t("detail.section.notes")}
                />
              ) : (
                <p className={styles.bodyText}>{target.profile.notes?.trim() || t("detail.empty.notes")}</p>
              )}
            </DetailSection>

            {canEditMember ? (
              <div className={styles.instantStack}>
                <p className={styles.mutedText}>{t("detail.hint.instant")}</p>
                <div className={styles.stack}>
                  <AbsenceManagerCard userId={target.user.id} />
                  {mediaTab}
                </div>
              </div>
            ) : (
              <>
                <DetailSection title={t("detail.section.vacation")}>
                  <p className={styles.bodyText}>{absenceSummary}</p>
                </DetailSection>
                <DetailSection title={t("detail.section.media")}>
                  <p className={styles.bodyText}>{mediaSummary}</p>
                </DetailSection>
              </>
            )}

            <div className={`${styles.saveBar} ${styles.saveBarEnd}`}>
              <Button variant="outline" onClick={() => void handleCancelEdit()} size="lg">
                {t("common:action.cancel")}
              </Button>
              <Button
                onClick={handleSave}
                loading={saveProfilePending}
                disabled={!isDirty || saveProfilePending}
                size="lg"
              >
                <SaveIcon size={18} data-icon="inline-start" />
                {t("detail.saveProfile")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.readGrid}>
              <DetailSection title={t("detail.field.bio")}>
                <p className={styles.bodyText}>{target.profile.bio?.trim() || t("detail.empty.bio")}</p>
              </DetailSection>
              <DetailSection
                title={t("detail.section.notes")}
                action={<span className={styles.mutedText}>{t("detail.notesVisibility")}</span>}
              >
                <p className={styles.bodyText}>{target.profile.notes?.trim() || t("detail.empty.notes")}</p>
              </DetailSection>
              <DetailSection title={t("detail.section.vacation")}>
                <p className={styles.bodyText}>{absenceSummary}</p>
              </DetailSection>
              <DetailSection title={t("detail.section.media")}>
                <p className={styles.bodyText}>{mediaSummary}</p>
              </DetailSection>
            </div>

            <div className={`${styles.saveBar} ${canSaveMember ? styles.saveBarEnd : styles.saveBarSplit}`}>
              {canSaveMember ? null : (
                <span className={styles.mutedText}>{t("detail.hint.cannotManage")}</span>
              )}
              <Button onClick={() => setView("edit")} disabled={!canSaveMember} size="lg">
                {t("detail.action.edit")}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  };

  const title = member
    ? t("detail.titleWithName", { display_name: member.user.display_name })
    : t("detail.title");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) onClose();
  };
  const detailBody = member ? renderBody(member) : null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} swipeDirection="down">
        <DrawerContent className={styles.drawerContent}>
          <DrawerHeader className={styles.inspectorHeader}>
            <div className={styles.headingRow}>
              <DrawerTitle>{title}</DrawerTitle>
              <DrawerClose
                aria-label={t("common:action.close")}
                render={<Button size="icon-sm" variant="ghost" />}
              >
                <XIcon size={16} />
              </DrawerClose>
            </div>
            <DrawerDescription className="sr-only">{t("detail.title")}</DrawerDescription>
          </DrawerHeader>
          {detailBody}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className={styles.inspectorContent} showCloseButton={false}>
        <SheetHeader className={styles.inspectorHeader}>
          <div className={styles.headingRow}>
            <SheetTitle>{title}</SheetTitle>
            <SheetClose
              aria-label={t("common:action.close")}
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <XIcon size={16} />
            </SheetClose>
          </div>
          <SheetDescription className="sr-only">{t("detail.title")}</SheetDescription>
        </SheetHeader>
        {detailBody}
      </SheetContent>
    </Sheet>
  );
}
