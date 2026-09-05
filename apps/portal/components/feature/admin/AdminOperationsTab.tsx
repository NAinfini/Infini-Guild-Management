import type { AdminOperationsResponse } from "@guild/shared/schemas/admin-operations";
import { Alert, AlertTitle } from "@portal/components/ui/alert";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import { useAuthStore } from "../../../stores/auth";
import { formatDateTime } from "../../../utils/datetime";
import { latencyBand } from "../../../utils/latency-thresholds";
import { userCanViewStatus } from "../../../utils/permissions";
import { AdminSystemSection, serviceState } from "./AdminSystemSection";
import "./AdminOperationsTab.css";
import { AdminLoadError } from "./AdminLoadError";

type StatusData = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

type StatusHealthLog = {
  at: string;
  db: string;
  r2: string;
  ws: string;
  crons: string;
  latencyMs: number | null;
};

export type AdminOperationsTabProps = {
  statusLatencyMs: number | null;
  statusLoading: boolean;
  statusError: boolean;
  onRetryStatus: () => void;
  statusData: StatusData | null;
  statusHealthLogs: StatusHealthLog[];
  operationsData: AdminOperationsResponse | null;
  operationsLoading: boolean;
  operationsError: boolean;
  onRetryOperations: () => void;
};

function byteParts(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return {
    value: new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 && unitIndex > 0 ? 1 : 0 }).format(value),
    unit: units[unitIndex],
  };
}

function durationParts(durationMs: number) {
  if (durationMs < 1000) return { value: durationMs, unit: "ms" };
  if (durationMs < 60_000) return { value: Math.round(durationMs / 1000), unit: "s" };
  return { value: Math.round(durationMs / 60_000), unit: "min" };
}

function number(value: number | null) {
  return value === null ? null : new Intl.NumberFormat().format(value);
}

export function AdminOperationsTab({
  statusLatencyMs,
  statusLoading,
  statusError,
  onRetryStatus,
  statusData,
  statusHealthLogs,
  operationsData,
  operationsLoading,
  operationsError,
  onRetryOperations,
}: AdminOperationsTabProps) {
  const { t } = useTranslation("admin");
  const user = useAuthStore((state) => state.user);

  if (!userCanViewStatus(user)) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("adminOnly")}</AlertTitle>
      </Alert>
    );
  }

  const renderHealthLogStatus = (value: string, labelKey: string) => {
    const service = serviceState(value);
    const state = service === "configured" ? "warn" : service;
    return (
      <Tooltip>
        <TooltipTrigger render={<span
          className="operations-health-log__service"
          aria-label={`${t(labelKey)}: ${value}`}
          tabIndex={0}
        />}>
          <span className={`operations-health-log__dot operations-health-log__dot--${state}`} />
          {t(labelKey)}
        </TooltipTrigger>
        <TooltipContent>{value.toUpperCase()}</TooltipContent>
      </Tooltip>
    );
  };

  const jobs = operationsData?.scheduled_jobs ?? [];
  const healthLogs = statusHealthLogs.slice(0, 5);

  return (
    <div className="admin-operations">
      <section className="admin-panel operations-health">
        <div className="admin-panel__head">
          <div className="admin-panel__title"><span>{t("operations.health.title")}</span></div>
        </div>
        <AdminSystemSection
          statusLoading={statusLoading}
          statusError={statusError}
          onRetryStatus={onRetryStatus}
          statusData={statusData}
          statusLatencyMs={statusLatencyMs}
        />
      </section>

      <div className="operations-workspace">
        <section className="admin-panel operations-panel operations-panel--jobs">
          <div className="admin-panel__head">
            <div className="admin-panel__title">
              <span>{t("operations.jobs.title")}</span>
              <span className="admin-count">{jobs.length}</span>
            </div>
            {operationsData ? (
              <span className="operations-panel__observed">
                {t("operations.observedAt", { value: formatDateTime(operationsData.observed_at) })}
              </span>
            ) : null}
          </div>
          <div className="admin-panel__body admin-panel__body--flush admin-panel__body--scroll">
            {operationsError ? <AdminLoadError onRetry={onRetryOperations} /> : null}
            {operationsLoading && !operationsData ? (
              <LoadingIndicator />
            ) : operationsData ? (
              <table className="operations-jobs-table" aria-label={t("operations.jobs.title")}>
                <thead>
                  <tr>
                    <th>{t("operations.jobs.column.name")}</th>
                    <th>{t("operations.jobs.column.schedule")}</th>
                    <th>{t("operations.jobs.column.status")}</th>
                    <th>{t("operations.jobs.column.latestRun")}</th>
                    <th>{t("operations.jobs.column.work")}</th>
                    <th>{t("operations.jobs.column.lease")}</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const finishedAt = job.finished_at ?? job.started_at;
                    const backlog = job.backlog?.pending_count;
                    const backlogValue = backlog === null || backlog === undefined
                      ? t("operations.value.unavailable")
                      : job.backlog?.count_precision === "at-least"
                        ? t("operations.jobs.backlogAtLeast", { count: number(backlog) })
                        : number(backlog);
                    return (
                      <tr key={job.name} className={`operations-jobs-table__row--${job.status}`}>
                        <td data-label={t("operations.jobs.column.name")}>
                          <div className="operations-job-name">
                            <strong className="operations-job-name__label">{t(`operations.jobs.name.${job.name}`)}</strong>
                            {job.error_summary ? (
                              /* 摘要在格子里被省略号截断，完整文本只能靠提示给；错误可以很长，
                                 所以这一条允许换行。 */
                              <Tooltip>
                                <TooltipTrigger render={<span className="operations-job-name__error" tabIndex={0} />}>
                                  {job.error_summary}
                                </TooltipTrigger>
                                <TooltipContent className="operations-tooltip">{job.error_summary}</TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                        </td>
                        <td data-label={t("operations.jobs.column.schedule")}>
                          {t(`operations.schedule.${job.schedule}`)}
                        </td>
                        <td data-label={t("operations.jobs.column.status")}>
                          <span className={`operations-state operations-state--${job.status}`}>
                            <span className="operations-state__dot" />
                            {t(`operations.jobs.status.${job.status}`)}
                          </span>
                        </td>
                        <td data-label={t("operations.jobs.column.latestRun")}>
                          <div className="operations-job-run">
                            <time dateTime={finishedAt ?? undefined}>
                              {finishedAt ? formatDateTime(finishedAt) : t("operations.value.never")}
                            </time>
                            {job.duration_ms !== null ? (
                              <span>{t("operations.value.duration", durationParts(job.duration_ms))}</span>
                            ) : null}
                          </div>
                        </td>
                        <td data-label={t("operations.jobs.column.work")}>
                          {job.backlog?.detail ? (
                            <Tooltip>
                              <TooltipTrigger render={<div className="operations-job-work" tabIndex={0} />}>
                                <span>{t("operations.jobs.processed", { count: number(job.processed) ?? t("operations.value.unavailable") })}</span>
                                <span>{t("operations.jobs.backlog", { count: backlogValue })}</span>
                              </TooltipTrigger>
                              <TooltipContent className="operations-tooltip">{job.backlog.detail}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <div className="operations-job-work" tabIndex={job.backlog?.detail ? 0 : undefined}>
                              <span>{t("operations.jobs.processed", { count: number(job.processed) ?? t("operations.value.unavailable") })}</span>
                              <span>{t("operations.jobs.backlog", { count: backlogValue })}</span>
                            </div>
                          )}
                        </td>
                        <td data-label={t("operations.jobs.column.lease")}>
                          {job.lease.state === "held" ? (
                            <Tooltip>
                              <TooltipTrigger render={<span className="operations-lease operations-lease--held" tabIndex={0} />}>
                                {t("operations.lease.held")}
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("operations.lease.expiresAt", { at: formatDateTime(job.lease.expires_at) })}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="operations-lease">{t("operations.lease.none")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState className="admin-empty" title={t("operations.value.unavailable")} />
            )}
          </div>
        </section>

        <section className="admin-panel operations-panel operations-panel--realtime">
          <div className="admin-panel__head">
            <div className="admin-panel__title"><span>{t("operations.realtime.title")}</span></div>
          </div>
          <div className="admin-panel__body admin-panel__body--scroll">
            {operationsLoading && !operationsData ? (
              <LoadingIndicator />
            ) : operationsData ? (
              <dl className="operations-facts">
                <div>
                  <dt>{t("operations.realtime.state")}</dt>
                  <dd className={`operations-state operations-state--${operationsData.realtime.state}`}>
                    <span className="operations-state__dot" />
                    {t(`operations.realtime.state.${operationsData.realtime.state}`)}
                  </dd>
                </div>
                <div>
                  <dt>{t("operations.realtime.connections")}</dt>
                  <dd className="operations-value">
                    {operationsData.realtime.connection_count === null
                      ? t("operations.value.unavailable")
                      : number(operationsData.realtime.connection_count)}
                  </dd>
                </div>
                <div>
                  <dt>{t("operations.realtime.source")}</dt>
                  <dd>{t(`operations.realtime.source.${operationsData.realtime.runtime_source}`)}</dd>
                </div>
                <div>
                  <dt>{t("operations.realtime.observedAt")}</dt>
                  <dd className="operations-value">{formatDateTime(operationsData.realtime.observed_at)}</dd>
                </div>
              </dl>
            ) : (
              <EmptyState className="admin-empty" title={t("operations.value.unavailable")} />
            )}
          </div>
        </section>

        <section className="admin-panel operations-panel operations-panel--usage">
          <div className="admin-panel__head">
            <div>
              <div className="admin-panel__title"><span>{t("operations.usage.title")}</span></div>
              <p className="operations-panel__disclosure">{t("operations.usage.managedDisclosure")}</p>
            </div>
          </div>
          <div className="admin-panel__body admin-panel__body--scroll">
            {operationsLoading && !operationsData ? (
              <LoadingIndicator />
            ) : operationsData ? (
              <>
                <div className="admin-stats admin-stats--3 admin-stats--inset">
                  <div className="admin-stat">
                    <div className="admin-stat__value">{number(operationsData.managed_data_usage.media.asset_count)}</div>
                    <div className="admin-stat__label">{t("operations.usage.mediaAssets")}</div>
                  </div>
                  <div className="admin-stat">
                    <div className="admin-stat__value">{number(operationsData.managed_data_usage.media.variant_count)}</div>
                    <div className="admin-stat__label">{t("operations.usage.mediaVariants")}</div>
                  </div>
                  <div className="admin-stat">
                    <div className="admin-stat__value">{t("operations.value.bytes", byteParts(operationsData.managed_data_usage.media.logical_bytes))}</div>
                    <div className="admin-stat__label">{t("operations.usage.logicalBytes")}</div>
                  </div>
                </div>
                <table className="operations-usage-table" aria-label={t("operations.usage.mediaByState")}>
                  <thead>
                    <tr>
                      <th>{t("operations.usage.column.state")}</th>
                      <th>{t("operations.usage.column.assets")}</th>
                      <th>{t("operations.usage.column.variants")}</th>
                      <th>{t("operations.usage.column.logicalBytes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationsData.managed_data_usage.media.by_state.map((entry) => (
                      <tr key={entry.state}>
                        <td>{t(`operations.usage.state.${entry.state}`)}</td>
                        <td>{number(entry.asset_count)}</td>
                        <td>{number(entry.variant_count)}</td>
                        <td>{t("operations.value.bytes", byteParts(entry.logical_bytes))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="operations-audit-usage">
                  <div>
                    <dt>{t("operations.usage.auditLogs")}</dt>
                    <dd>{number(operationsData.managed_data_usage.audit.log_count)}</dd>
                  </div>
                  <div>
                    <dt>{t("operations.usage.auditArchives")}</dt>
                    <dd>{number(operationsData.managed_data_usage.audit.archive_count)}</dd>
                  </div>
                  <div>
                    <dt>{t("operations.usage.auditArchiveBytes")}</dt>
                    <dd>{t("operations.value.bytes", byteParts(operationsData.managed_data_usage.audit.archive_bytes))}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <EmptyState className="admin-empty" title={t("operations.value.unavailable")} />
            )}
          </div>
        </section>

        <section className="admin-panel operations-panel operations-panel--health-log">
          <div className="admin-panel__head">
            <div className="admin-panel__title">
              <span>{t("status.healthLogs.title")}</span>
              <span className="admin-count">{healthLogs.length}</span>
            </div>
          </div>
          <div className="admin-panel__body admin-panel__body--flush admin-panel__body--scroll operations-health-log">
            {healthLogs.length === 0 ? (
              <EmptyState className="admin-empty" title={t("status.healthLogs.empty")} />
            ) : (
              <table className="operations-health-log__table" aria-label={t("status.healthLogs.title")}>
                <thead>
                  <tr>
                    <th>{t("audit.table.time")}</th>
                    <th>{t("status.healthLogs.services")}</th>
                    <th>{t("status.latency")}</th>
                  </tr>
                </thead>
                <tbody>
                  {healthLogs.map((row, index) => (
                    <tr key={`${row.at}-${index}`}>
                      <td>{formatDateTime(row.at)}</td>
                      <td>
                        <span className="operations-health-log__services">
                          {renderHealthLogStatus(row.db, "status.service.db")}
                          {renderHealthLogStatus(row.r2, "status.service.r2")}
                          {renderHealthLogStatus(row.ws, "status.service.ws")}
                          {renderHealthLogStatus(row.crons, "status.service.crons")}
                        </span>
                      </td>
                      <td className={`operations-health-log__latency operations-health-log__latency--${latencyBand(row.latencyMs ?? 0)}`}>
                        {row.latencyMs == null ? "—" : `${row.latencyMs} ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
