import {
  Alert,
  Badge,
  Button,
  Collapse,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { ChevronRightIcon, ClipboardIcon, PlayIcon } from "@portal/components/icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { userCanViewStatus } from "../../../utils/permissions";
import { formatDateTime } from "../../../utils/admin";
import { latencyBand, latencyScalePercent } from "../../../utils/latency-thresholds";
import { AdminSystemSection } from "./AdminSystemSection";
import { buildApiCategories, filterApiCategoriesForPermissions } from "./AdminApiTestEngine";
import { ApiTestCategory } from "./AdminApiTestCategory";
import { AdminApiDebugConsole } from "./AdminApiDebugConsole";
import { useAdminApiTestRunner } from "./useAdminApiTestRunner";
import "./AdminApiTest.css";
import "./AdminStatusTab.css";

type StatusData = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
  system_tests_enabled?: boolean;
};

type StatusHealthLog = {
  at: string;
  db: string;
  r2: string;
  ws: string;
  crons: string;
  latencyMs: number | null;
};

/*
 * 折叠区的开合把手：一个 chevron + 标题，状态挂在 aria-expanded 上。
 * 和这一页里早就有的 .api-cat__toggle 是同一套把手，不另起一种。
 */
function SectionToggle({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="admin-status-toggle" aria-expanded={open} onClick={onToggle}>
      <span className={`admin-status-toggle__chevron${open ? " admin-status-toggle__chevron--open" : ""}`}>
        <ChevronRightIcon size={14} />
      </span>
      {children}
    </button>
  );
}

type AdminStatusTabProps = {
  onCopyConfigSummary: () => void;
  canCopyConfigSummary: boolean;
  statusLatencyMs: number | null;
  statusLoading: boolean;
  statusError: boolean;
  statusData: StatusData | null;
  statusHealthLogs: StatusHealthLog[];
};

export function AdminStatusTab({
  onCopyConfigSummary,
  canCopyConfigSummary,
  statusLatencyMs,
  statusLoading,
  statusError,
  statusData,
  statusHealthLogs,
}: AdminStatusTabProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const user = useAuthStore((state) => state.user);
  const apiCategories = useMemo(() => buildApiCategories(t), [t]);
  const visibleApiCategories = useMemo(
    () => filterApiCategoriesForPermissions(apiCategories, user?.permissions),
    [apiCategories, user?.permissions],
  );
  const isAdmin = userCanViewStatus(user);
  const loadErrorMessage = tc("loadError");
  const {
    debugLogs,
    runningSet,
    resultMap,
    runningAll,
    runCategory,
    runAllCategories,
    clearDebug,
    stop,
  } = useAdminApiTestRunner(visibleApiCategories);
  const isRunning = runningAll || runningSet.size > 0;
  const systemTestsEnabled = statusData?.system_tests_enabled === true;

  /*
   * 三块内容默认折起：这一页最常用的动作是「扫一眼四个服务是不是绿的」，
   * 而健康日志、API 控制台、调试台三块加起来能顶掉两屏，把健康面板挤到最上面一条缝里。
   */
  const [healthLogsOpen, setHealthLogsOpen] = useState(false);
  const [apiConsoleOpen, setApiConsoleOpen] = useState(false);
  const [debugConsoleOpen, setDebugConsoleOpen] = useState(false);

  /*
   * 但一旦跑起来就必须把两台控制台摊开：结果正往里写，盒子却是收着的，
   * 等于按了运行什么都看不到。只在开跑那一刻打开，之后用户想收就收，不再强行掰开。
   */
  useEffect(() => {
    if (!isRunning) return;
    setApiConsoleOpen(true);
    setDebugConsoleOpen(true);
  }, [isRunning]);

  if (!isAdmin) {
    return (
      <Stack gap={12}>
        <Alert color="red" title={t("adminOnly")} />
      </Stack>
    );
  }

  const totalEndpoints = visibleApiCategories.reduce((sum, cat) => sum + cat.endpoints.length, 0);
  const completedEndpoints = Math.min(resultMap.size, totalEndpoints);
  const progressPercent = totalEndpoints > 0 ? (completedEndpoints / totalEndpoints) * 100 : 0;
  /* 一次都没跑过、也没在跑，就没有进度可报，那根条子不该占位。 */
  const hasProgress = isRunning || completedEndpoints > 0;

  let passedEndpoints = 0;
  let failedEndpoints = 0;
  for (const [, r] of resultMap) {
    if (r.skipped && r.error === null) passedEndpoints++;
    else if (r.status !== null && r.status >= 200 && r.status < 400) passedEndpoints++;
    else failedEndpoints++;
  }

  const renderHealthLogStatus = (value: string) => {
    const state = value === "ok" ? "ok" : value === "configured" || value === "degraded" ? "warn" : "error";
    const label = value === "ok" || value === "configured"
      ? t(`status.value.${value}`)
      : value.toUpperCase();
    return (
      <td>
        <span className={`health-log-dot health-log-dot--${state}`} />
        {label}
      </td>
    );
  };

  return (
    <Stack gap={16}>

      <section className="admin-status-card">
        <div className="admin-status-card__head">
          <Text fw={700} size="sm">{t("status.section.health")}</Text>
          <Button
            className="admin-status-card__action"
            variant="default"
            onClick={onCopyConfigSummary}
            disabled={!canCopyConfigSummary}
            leftSection={<ClipboardIcon size={14} />}
          >
            {t("status.copyConfig")}
          </Button>
        </div>
        <div className="admin-status-card__body">
          <AdminSystemSection
            statusLoading={statusLoading}
            statusError={statusError}
            loadErrorMessage={loadErrorMessage}
            statusData={statusData}
            statusLatencyMs={statusLatencyMs}
          />
        </div>
      </section>

      {/* ── 健康日志 ─────────────────────────────── */}
      <section className="admin-status-card">
        <div className="admin-status-card__head">
          <SectionToggle open={healthLogsOpen} onToggle={() => setHealthLogsOpen((open) => !open)}>
            <Text fw={700} size="sm">{t("status.healthLogs.title")}</Text>
            <Badge size="xs" variant="default">{statusHealthLogs.length}</Badge>
          </SectionToggle>
        </div>
        <Collapse expanded={healthLogsOpen}>
          <div className="admin-status-card__body">
            <ScrollArea h={200} scrollbarSize={6} type="always">
              {statusHealthLogs.length === 0 ? (
                <Text c="dimmed" size="sm">{t("status.healthLogs.empty")}</Text>
              ) : (
                <table className="health-log-table">
                  <thead>
                    <tr>
                      <th>{t("audit.table.time")}</th>
                      <th>DB</th>
                      <th>R2</th>
                      <th>WS</th>
                      <th>{t("status.service.crons")}</th>
                      <th>{t("status.latency")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusHealthLogs.map((row, index) => {
                      const latency = row.latencyMs ?? 0;
                      // Status cards and the log share the same latency bands.
                      const band = latencyBand(latency);
                      return (
                        <tr key={`${row.at}-${index}`}>
                          <td className="health-log-time">
                            {formatDateTime(row.at)}
                          </td>
                          {renderHealthLogStatus(row.db)}
                          {renderHealthLogStatus(row.r2)}
                          {renderHealthLogStatus(row.ws)}
                          {renderHealthLogStatus(row.crons)}
                          <td>
                            <span className="health-log-latency">
                              <span
                                className={`health-log-latency-bar health-log-latency-bar--${band}`}
                                style={{ width: `${latencyScalePercent(latency)}%` }}
                              />
                              <span className={`health-log-latency-value health-log-latency-value--${band}`}>{row.latencyMs ?? "—"}ms</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </div>
        </Collapse>
      </section>

      {systemTestsEnabled ? (
        <>
      {/* ── API Test Console ────────────────────────── */}
      <div className="api-console">
        <div className={`api-console__header${hasProgress ? " api-console__header--with-progress" : ""}`}>
          <div className="api-console__header-left">
            <SectionToggle open={apiConsoleOpen} onToggle={() => setApiConsoleOpen((open) => !open)}>
              <Text fw={700} size="sm">{t("status.section.apiTests")}</Text>
              <Badge size="xs" variant="default">{t("status.api.endpointCount", { count: totalEndpoints })}</Badge>
            </SectionToggle>

            {completedEndpoints > 0 ? (
              <div className="api-console__stats">
                <span className="api-console__stat">
                  <span className="api-console__stat-dot api-console__stat-dot--pass" />
                  <span className="api-console__stat-value">{passedEndpoints}</span>
                  {t("status.api.pass")}
                </span>
                {failedEndpoints > 0 ? (
                  <span className="api-console__stat">
                    <span className="api-console__stat-dot api-console__stat-dot--fail" />
                    <span className="api-console__stat-value">{failedEndpoints}</span>
                    {t("status.api.fail")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="api-console__header-actions">
            {isRunning ? (
              <Button
                className="api-console__stop"
                color="red"
                variant="light"
                onClick={stop}
              >
                {t("status.api.stop")}
              </Button>
            ) : null}
            <Button
              className="api-console__run-all"
              onClick={() => { void runAllCategories(); }}
              leftSection={<PlayIcon size={14} />}
              loading={runningAll}
              disabled={isRunning}
            >
              {t("status.api.runAll")}
            </Button>
          </div>
        </div>

        {hasProgress ? (
          <div className="api-console__progress-track">
            <div
              className={`api-console__progress-fill${runningAll ? " api-console__progress-fill--running" : ""}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : null}

        <Collapse expanded={apiConsoleOpen}>
          <div className="api-cat-list">
            {visibleApiCategories.map((cat) => (
              <ApiTestCategory
                key={cat.key}
                category={cat}
                onRunCategory={runCategory}
                runningSet={runningSet}
                resultMap={resultMap}
              />
            ))}
          </div>
        </Collapse>
      </div>

      {/* ── Debug Console ─────────────────────────── */}
      <AdminApiDebugConsole
        logs={debugLogs}
        onClear={clearDebug}
        open={debugConsoleOpen}
        onToggle={() => setDebugConsoleOpen((open) => !open)}
      />
        </>
      ) : statusData ? (
        <Alert color="yellow" title={t("status.api.disabledTitle")}>
          {t("status.api.disabledDescription")}
        </Alert>
      ) : null}
    </Stack>
  );
}
