import { Alert, Badge, Group, HoverCard, RingProgress, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import { CircleCheckIcon, AlertTriangleIcon, DatabaseIcon, CloudIcon, WifiIcon, ClockIcon } from "@portal/components/icons";
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
  icon: typeof DatabaseIcon;
  label: string;
  okColor: string;
  errorColor: string;
};

const SERVICES: ServiceInfo[] = [
  { key: "db", icon: DatabaseIcon, label: "D1", okColor: "#10b981", errorColor: "#ef4444" },
  { key: "r2", icon: CloudIcon, label: "R2", okColor: "#10b981", errorColor: "#ef4444" },
  { key: "ws", icon: WifiIcon, label: "WS", okColor: "#10b981", errorColor: "#eab308" },
  { key: "crons", icon: ClockIcon, label: "Crons", okColor: "#10b981", errorColor: "#ef4444" },
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
    return <Alert color="portal-copper" title={loadErrorMessage} />;
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
          <HoverCard key={svc.key} width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
            <HoverCard.Target>
              <div data-animate-icon-trigger className={`system-health-tile ${isOk ? "system-health-tile--ok" : "system-health-tile--error"}`}>
                <div className="system-health-tile__icon" style={{ color }}>
                  <Icon size={22} />
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
            </HoverCard.Target>
            <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
              <Group gap={10} wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" color="portal-bronze" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                  <Icon size={16} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={700} lh={1.3} mb={4}>{svc.label}</Text>
                  <Text size="xs" c="dimmed" lh={1.5}>{t(`status.tooltip.${svc.key}`)}</Text>
                </div>
              </Group>
            </HoverCard.Dropdown>
          </HoverCard>
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
          <Text size="xs" fw={700} className="system-health-tile__label">{t("status.latency")}</Text>
          <Text size="10px" c="dimmed">ms</Text>
        </Stack>
      </div>

      <HoverCard width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
        <HoverCard.Target>
          <div data-animate-icon-trigger className={`system-health-overall ${allOk ? "system-health-overall--ok" : "system-health-overall--warn"}`}>
            <div className={`system-health-overall__dot ${allOk ? "system-health-overall__dot--ok" : "system-health-overall__dot--warn"}`} />
            <Text size="xs" fw={700}>{allOk ? t("status.operational") : t("status.degraded")}</Text>
          </div>
        </HoverCard.Target>
        <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
          <Group gap={10} wrap="nowrap" align="flex-start">
            <ThemeIcon variant="light" color={allOk ? "green" : "yellow"} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
              {allOk ? <CircleCheckIcon size={16} /> : <AlertTriangleIcon size={16} />}
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={700} lh={1.3}>{allOk ? t("status.tooltip.overallHealthy.title") : t("status.tooltip.overallDegraded.title")}</Text>
              <Text size="xs" c="dimmed" lh={1.5}>{allOk ? t("status.tooltip.overallHealthy.desc") : t("status.tooltip.overallDegraded.desc")}</Text>
            </div>
          </Group>
        </HoverCard.Dropdown>
      </HoverCard>
    </div>
  );
}
