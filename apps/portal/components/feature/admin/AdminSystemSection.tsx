import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { ClockIcon, CloudIcon, DatabaseIcon, WifiIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import "./AdminSystemSection.css";
import { AdminLoadError } from "./AdminLoadError";

type StatusData = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

type AdminSystemSectionProps = {
  statusLoading: boolean;
  statusError: boolean;
  onRetryStatus: () => void;
  statusData: StatusData | null;
  statusLatencyMs?: number | null;
};

type ServiceState = "ok" | "configured" | "error";

const SERVICES = [
  { key: "db", icon: DatabaseIcon, labelKey: "status.service.db", runtime: "D1" },
  { key: "r2", icon: CloudIcon, labelKey: "status.service.r2", runtime: "R2" },
  { key: "ws", icon: WifiIcon, labelKey: "status.service.ws", runtime: "Durable Object" },
  { key: "crons", icon: ClockIcon, labelKey: "status.service.crons", runtime: "Cron Triggers" },
] satisfies Array<{
  key: keyof StatusData;
  icon: typeof DatabaseIcon;
  labelKey: string;
  runtime: string;
}>;

export function serviceState(value: string): ServiceState {
  if (value === "ok" || value.startsWith("ok (")) return "ok";
  if (
    value === "configured"
    || value.startsWith("configured (")
    || value === "degraded"
    || value.startsWith("degraded (")
  ) return "configured";
  return "error";
}

export function AdminSystemSection({
  statusLoading,
  statusError,
  onRetryStatus,
  statusData,
  statusLatencyMs,
}: AdminSystemSectionProps) {
  const { t } = useTranslation("admin");

  if (statusLoading) {
    return (
      <LoadingIndicator />
    );
  }

  if (statusError && !statusData) {
    return <AdminLoadError onRetry={onRetryStatus} />;
  }

  if (!statusData) return null;

  const states = SERVICES.map((service) => serviceState(statusData[service.key]));
  const allOk = states.every((state) => state === "ok");
  const hasFailure = states.some((state) => state === "error");
  const overallState = allOk ? "ok" : hasFailure ? "error" : "configured";
  const overallLabel = allOk
    ? t("status.operational")
    : hasFailure
      ? t("status.degraded")
      : t("status.partiallyVerified");

  return (
    <section className="system-health-ledger" aria-label={t("status.section.health")}>
      <div className="system-health-ledger__summary">
        <span className={`system-health-ledger__dot system-health-ledger__dot--${overallState}`} />
        <strong className="system-health-ledger__overall">{overallLabel}</strong>
        <span className="system-health-ledger__summary-spacer" />
        <span className="system-health-ledger__latency-label">{t("status.latency")}</span>
        <span className="system-health-ledger__latency">
          {statusLatencyMs == null ? "—" : `${statusLatencyMs} ms`}
        </span>
      </div>

      <div className="system-health-ledger__table-wrap">
        <table className="system-health-ledger__table">
          <thead>
            <tr>
              <th>{t("status.service.label")}</th>
              <th>{t("status.service.state")}</th>
              <th>{t("status.service.signal")}</th>
            </tr>
          </thead>
          <tbody>
            {SERVICES.map((service) => {
              const value = statusData[service.key];
              const state = serviceState(value);
              const Icon = service.icon;
              const degraded = value === "degraded" || value.startsWith("degraded (");
              const stateLabel = degraded
                ? value.toUpperCase()
                : state === "ok"
                  ? t("status.value.ok")
                  : state === "configured"
                    ? t("status.value.configured")
                    : value.toUpperCase();
              const signalLabel = service.key === "db" || service.key === "r2"
                ? service.runtime
                : degraded
                  ? t("status.signal.degraded")
                  : state === "ok"
                    ? t("status.signal.ok")
                    : state === "configured"
                      ? t("status.signal.configured")
                      : t("status.signal.error");

              return (
                <tr key={service.key} className={`system-health-ledger__row system-health-ledger__row--${state}`}>
                  <td>
                    <span className="system-health-ledger__service">
                      <span className={`system-health-ledger__icon system-health-ledger__icon--${state}`}>
                        <Icon size={17} />
                      </span>
                      <span>{t(service.labelKey)}</span>
                    </span>
                  </td>
                  <td>
                    <span className={`system-health-ledger__state system-health-ledger__state--${state}`}>
                      <span className={`system-health-ledger__dot system-health-ledger__dot--${state}`} />
                      {stateLabel}
                    </span>
                  </td>
                  <td className="system-health-ledger__signal">{signalLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
