import { Select, Text } from "@mantine/core";
import { EyeOutlined } from "../../utils/icons";

export type ViewingAsRole = "admin" | "moderator" | "member" | "external";

type ViewingAsSelectorProps = {
  value: ViewingAsRole;
  compact?: boolean;
  onChange: (nextRole: ViewingAsRole) => void;
};

const options: Array<{ value: ViewingAsRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "moderator", label: "Moderator" },
  { value: "member", label: "Member" },
  { value: "external", label: "External" },
];

export function ViewingAsSelector({ value, compact = false, onChange }: ViewingAsSelectorProps) {
  return (
    <div className={`app-viewing-as ${compact ? "app-viewing-as--compact" : ""}`.trim()}>
      {!compact ? (
        <Text c="dimmed" className="app-viewing-as-label">
          Viewing As
        </Text>
      ) : null}
      <Select
        value={value}
        onChange={(nextRole) => {
          if (nextRole) {
            onChange(nextRole as ViewingAsRole);
          }
        }}
        size="xs"
        className="app-viewing-as-select"
        aria-label="View the app as role"
        leftSection={<EyeOutlined size={14} />}
        data={options}
        checkIconPosition="right"
      />
    </div>
  );
}
