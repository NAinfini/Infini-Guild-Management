import { Alert, Badge, RingProgress, Skeleton, Stack, Text, Tooltip } from "@mantine/core";
import { IconDatabase, IconCloud, IconWifi, IconClock } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import "./AdminSystemSection.css";

type StatusData = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

type AdminSystemSectionProps = {
  statusLoading: boolean;
  statusError: boolean;
  loadErrorMessage: string;
  statusData: StatusData | null;
  statusLatencyMs?: number | null;
};

type ServiceInfo = {
  key: keyof StatusData;
  icon: typeof IconDatabase;
  label: string;
  okColor: string;
  errorColor: string;
};

const SERVICES: ServiceInfo[] = [
  { key: "db", icon: IconDatabase, label: "D1", okColor: "#10b981", errorColor: "#ef4444" },
  { key: "r2", icon: IconCloud, label: "R2", okColor: "#10b981", errorColor: "#ef4444" },
  { key: "ws", icon: IconWifi, label: "WS", okColor: "#10b981", errorColor: "#eab308" },
  { key: "crons", icon: IconClock, label: "Crons", okColor: "#10b981", errorColor: "#ef4444" },
];

function latencyColor(ms: number): string {
  if (ms < 200) return "#10b981";
  if (ms < 400) return "#eab308";
  return "#ef4444";
}

function latencyPercent(ms: number): number {
  return Math.min(100, (ms / 500) * 100);
}

export function AdminSystemSection({
  statusLoading,
  statusError,
  loadErrorMessage,
  statusData,
  statusLatencyMs,
}: AdminSystemSectionProps) {
  const { t } = useTranslation("admin");

  if (statusLoading) {
    return (
      <div className="system-health-grid">
        {SERVICES.map((s) => (
          <Skeleton key={s.key} height={90} radius="md" />
        ))}
        <Skeleton height={90} radius="md" />
      </div>
    );
  }

  if (statusError) {
    return <Alert color="yellow" title={loadErrorMessage} />;
  }

  if (!statusData) return null;

  const allOk = SERVICES.every((s) => statusData[s.key] === "ok");

  return (
    <div className="system-health-grid">
      {SERVICES.map((svc) => {
        const isOk = statusData[svc.key] === "ok";
        const Icon = svc.icon;
        const color = isOk ? svc.okColor : svc.errorColor;

        return (
          <div key={svc.key} className={`system-health-tile ${isOk ? "system-health-tile--ok" : "system-health-tile--error"}`}>
            <div className="system-health-tile__icon" style={{ color }}>
              <Icon size={22} stroke={1.8} />
            </div>
            <Text size="xs" fw={700} className="system-health-tile__label">{svc.label}</Text>
            <Badge
              size="sm"
              variant="light"
              color={isOk ? "green" : svc.key === "ws" ? "yellow" : "red"}
              className="system-health-tile__badge"
            >
              {statusData[svc.key].toUpperCase()}
            </Badge>
          </div>
        );
      })}

      <div className="system-health-tile system-health-tile--latency">
        <RingProgress
          size={56}
          thickness={5}
          roundCaps
          sections={[{
            value: statusLatencyMs != null ? latencyPercent(statusLatencyMs) : 0,
            color: statusLatencyMs != null ? latencyColor(statusLatencyMs) : "gray",
          }]}
          label={
            <Text ta="center" size="11px" fw={700}>
              {statusLatencyMs != null ? `${statusLatencyMs}` : "—"}
            </Text>
          }
        />
        <Stack gap={0} align="center">
          <Text size="xs" fw={700} className="system-health-tile__label">Latency</Text>
          <Text size="10px" c="dimmed">ms</Text>
        </Stack>
      </div>

      <Tooltip label={allOk ? t("status.allHealthy", { defaultValue: "All systems operational" }) : t("status.hasIssues", { defaultValue: "Some services have issues" })} withArrow>
        <div className={`system-health-overall ${allOk ? "system-health-overall--ok" : "system-health-overall--warn"}`}>
          <div className={`system-health-overall__dot ${allOk ? "system-health-overall__dot--ok" : "system-health-overall__dot--warn"}`} />
          <Text size="xs" fw={700}>{allOk ? "Operational" : "Degraded"}</Text>
        </div>
      </Tooltip>
    </div>
  );
}
