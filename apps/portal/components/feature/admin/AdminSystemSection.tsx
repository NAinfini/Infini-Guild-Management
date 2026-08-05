import { Alert, Badge, Group, HoverCard, RingProgress, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import { CircleCheckIcon, AlertTriangleIcon, DatabaseIcon, CloudIcon, WifiIcon, ClockIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { latencyBand, latencyScalePercent, type LatencyBand } from "../../../utils/latency-thresholds";
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
};

type ServiceState = "ok" | "configured" | "error";

const SERVICES: ServiceInfo[] = [
  { key: "db", icon: DatabaseIcon, label: "D1" },
  { key: "r2", icon: CloudIcon, label: "R2" },
  { key: "ws", icon: WifiIcon, label: "WS" },
  { key: "crons", icon: ClockIcon, label: "Crons" },
];

// WebSocket disconnections are recoverable and use warning severity; failed
// persistence or cron services use danger severity.
function serviceState(value: string): ServiceState {
  if (value === "ok") return "ok";
  if (value === "configured") return "configured";
  return "error";
}

function iconTone(state: ServiceState, key: keyof StatusData): "ok" | "warning" | "danger" {
  if (state === "ok") return "ok";
  if (state === "configured") return "warning";
  return key === "ws" ? "warning" : "danger";
}

// Exported so the CSS class contract can be checked without duplicating it.
export const LATENCY_BAND_COLOR_VAR: Record<LatencyBand, string> = {
  good: "var(--status-success)",
  warn: "var(--status-warning)",
  bad: "var(--status-danger)",
};

// No-data rings stay on the same semantic palette as measured latency rings.
const LATENCY_NO_DATA_COLOR_VAR = "var(--text-muted)";

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
    return <Alert color="red" title={loadErrorMessage} />;
  }

  if (!statusData) return null;

  const states = SERVICES.map((service) => serviceState(statusData[service.key]));
  const allOk = states.every((state) => state === "ok");
  const hasFailure = states.some((state) => state === "error");
  const partiallyVerified = !allOk && !hasFailure;
  const overallLabel = allOk
    ? t("status.operational")
    : partiallyVerified
      ? t("status.partiallyVerified")
      : t("status.degraded");
  const overallTitle = allOk
    ? t("status.tooltip.overallHealthy.title")
    : partiallyVerified
      ? t("status.tooltip.overallPartial.title")
      : t("status.tooltip.overallDegraded.title");
  const overallDescription = allOk
    ? t("status.tooltip.overallHealthy.desc")
    : partiallyVerified
      ? t("status.tooltip.overallPartial.desc")
      : t("status.tooltip.overallDegraded.desc");

  return (
    <div className="system-health-grid">
      {SERVICES.map((svc) => {
        const value = statusData[svc.key];
        const state = serviceState(value);
        const isOk = state === "ok";
        const Icon = svc.icon;
        const tone = iconTone(state, svc.key);
        const badgeColor = isOk ? "green" : state === "configured" || svc.key === "ws" ? "yellow" : "red";
        const badgeLabel = value === "ok" || value === "configured"
          ? t(`status.value.${value}`)
          : value.toUpperCase();

        return (
          <HoverCard key={svc.key} width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
            <HoverCard.Target>
              <div data-animate-icon-trigger className={`system-health-tile system-health-tile--${state}`}>
                <div className={`system-health-tile__icon system-health-tile__icon--${tone}`}>
                  <Icon size={22} />
                </div>
                <Text size="xs" fw={700} className="system-health-tile__label">{svc.label}</Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={badgeColor}
                  className="system-health-tile__badge"
                >
                  {badgeLabel}
                </Badge>
              </div>
            </HoverCard.Target>
            <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
              <Group gap={10} wrap="nowrap" align="flex-start">
                <ThemeIcon variant="light" color="gray" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
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
            value: statusLatencyMs != null ? latencyScalePercent(statusLatencyMs) : 0,
            color: statusLatencyMs != null ? LATENCY_BAND_COLOR_VAR[latencyBand(statusLatencyMs)] : LATENCY_NO_DATA_COLOR_VAR,
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
            <Text size="xs" fw={700}>{overallLabel}</Text>
          </div>
        </HoverCard.Target>
        <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
          <Group gap={10} wrap="nowrap" align="flex-start">
            <ThemeIcon variant="light" color={allOk ? "green" : "yellow"} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
              {allOk ? <CircleCheckIcon size={16} /> : <AlertTriangleIcon size={16} />}
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={700} lh={1.3}>{overallTitle}</Text>
              <Text size="xs" c="dimmed" lh={1.5}>{overallDescription}</Text>
            </div>
          </Group>
        </HoverCard.Dropdown>
      </HoverCard>
    </div>
  );
}
