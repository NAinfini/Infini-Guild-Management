import type { AdminRole } from "@guild/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../stores/auth";
import { canPreviewRole } from "../../utils/permissions";
import { EyeOutlined } from "../../utils/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export type ViewingAsRole = string;

type ViewingAsSelectorProps = {
  value: ViewingAsRole;
  compact?: boolean;
  roles: AdminRole[];
  onChange: (nextRole: ViewingAsRole) => void;
};

export function ViewingAsSelector({ value, compact = false, roles, onChange }: ViewingAsSelectorProps) {
  const { t } = useTranslation(["common", "admin"]);
  const user = useAuthStore((state) => state.user);

  const options = useMemo(() => {
    const items = roles
      .filter((role) => canPreviewRole(role, user))
      .slice()
      .sort((a, b) => b.level - a.level)
      .map((role) => ({
        value: role.id,
        label: role.name,
      }));

    items.push({ value: "external", label: t("common:viewingAs.external") });
    return items;
  }, [roles, t, user]);

  if (compact) {
    return (
      <div className="app-viewing-as app-viewing-as--compact">
        <EyeOutlined size={16} aria-hidden />
      </div>
    );
  }

  return (
    <div className="app-viewing-as">
      <span className="app-viewing-as-label">
        {t("viewingAs.label")}
      </span>
      <Select
        value={value}
        items={options}
        onValueChange={(nextRole) => {
          if (nextRole) {
            onChange(nextRole);
          }
        }}
      >
        <SelectTrigger size="sm" className="w-full text-xs" aria-label={t("viewingAs.label")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
