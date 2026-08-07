import type { AdminRole } from "@guild/shared";
import { Select, Text } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EyeOutlined } from "../../utils/icons";

export type ViewingAsRole = string;

type ViewingAsSelectorProps = {
  value: ViewingAsRole;
  compact?: boolean;
  roles: AdminRole[];
  onChange: (nextRole: ViewingAsRole) => void;
};

export function ViewingAsSelector({ value, compact = false, roles, onChange }: ViewingAsSelectorProps) {
  const { t } = useTranslation(["common", "admin"]);

  const options = useMemo(() => {
    const items = roles
      .slice()
      .sort((a, b) => b.level - a.level)
      .map((role) => ({
        value: role.id,
        label: role.name,
      }));

    items.push({ value: "external", label: t("common:viewingAs.external") });
    return items;
  }, [roles, t]);

  if (compact) {
    return (
      <div className="app-viewing-as app-viewing-as--compact">
        <EyeOutlined size={16} />
      </div>
    );
  }

  return (
    <div className="app-viewing-as">
      <Text c="dimmed" className="app-viewing-as-label">
        {t("viewingAs.label")}
      </Text>
      <Select
        data={options}
        value={value}
        aria-label={t("viewingAs.label")}
        onChange={(val) => {
          if (val) {
            onChange(val);
          }
        }}
        size="xs"
        allowDeselect={false}
        styles={{
          input: { fontSize: 12 },
        }}
      />
    </div>
  );
}
