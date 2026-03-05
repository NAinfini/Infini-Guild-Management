import { DepthToggle } from "@infini-dev-kit/frontend/components";
import { Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { EyeOutlined } from "../../utils/icons";

export type ViewingAsRole = "admin" | "moderator" | "member" | "external";

type ViewingAsSelectorProps = {
  value: ViewingAsRole;
  compact?: boolean;
  onChange: (nextRole: ViewingAsRole) => void;
};

const ROLES: ViewingAsRole[] = ["admin", "moderator", "member", "external"];

export function ViewingAsSelector({ value, compact = false, onChange }: ViewingAsSelectorProps) {
  const { t } = useTranslation("common");

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
      <Group gap={4} wrap="nowrap">
        {ROLES.map((role) => (
          <DepthToggle
            key={role}
            pressed={value === role}
            onToggle={() => onChange(role)}
            size="sm"
            type={value === role ? "primary" : "secondary"}
            style={{ fontSize: 11 }}
          >
            {t(`viewingAs.${role}`)}
          </DepthToggle>
        ))}
      </Group>
    </div>
  );
}
