import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { ClipboardIcon, PlayIcon } from "@portal/components/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { userCanViewStatus } from "../../../utils/permissions";
import { formatDateTime } from "../../../utils/admin";
import { latencyBand } from "../../../utils/latency-thresholds";
import { AdminSystemSection } from "./AdminSystemSection";
import { buildApiCategories, filterApiCategoriesForPermissions } from "./AdminApiTestEngine";
import { ApiTestCategory } from "./AdminApiTestCategory";
import { AdminApiDebugConsole } from "./AdminApiDebugConsole";
import { useAdminApiTestRunner } from "./useAdminApiTestRunner";
import "./AdminApiTest.css";

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

  let passedEndpoints = 0;
  let failedEndpoints = 0;
  for (const [, r] of resultMap) {
    if (r.skipped && r.error === null) passedEndpoints++;
    else if (r.status !== null && r.status >= 200 && r.status < 400) passedEndpoints++;
    else failedEndpoints++;
  }
  const isRunning = runningAll || runningSet.size > 0;

  return (
    <Stack gap={16}>

      {/* ── System Health ─────────────────────────── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Paper withBorder radius="md">
          <div style={{ padding: "var(--card-padding)" }}>
            <Text fw={600} size="sm" mb={12}>{t("status.section.health")}</Text>
            <AdminSystemSection
              statusLoading={statusLoading}
              statusError={statusError}
              loadErrorMessage={loadErrorMessage}
              statusData={statusData}
              statusLatencyMs={statusLatencyMs}
            />
          </div>
        </Paper>

        <Paper withBorder radius="md">
          <div style={{ padding: "var(--card-padding)" }}>
            <Group justify="space-between" mb={12}>
              <Text fw={600} size="sm">{t("status.healthLogs.title")}</Text>
              <Button
                h={44}
                variant="default"
                onClick={onCopyConfigSummary}
                disabled={!canCopyConfigSummary}
                leftSection={<ClipboardIcon size={14} />}
              >
                {t("status.copyConfig")}
              </Button>
            </Group>
            <ScrollArea h={110} scrollbarSize={6} type="always">
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
                      const barWidth = Math.min(100, (latency / 500) * 100);
                      // 三段离散状态（好/警/差），按 the inline-style migration brief Step 3.4 的要求
                      // 切换预定义类，不拼接颜色字符串。200/400ms 阈值来自
                      // utils/latency-thresholds.ts——与 AdminSystemSection.tsx 共用
                      // 同一份定义，不再各自维护一份数值（the inline-style migration contract B 节，
                      // Task 8 批 C 收敛）。
                      const band = latencyBand(latency);
                      return (
                        <tr key={`${row.at}-${index}`}>
                          <td className="health-log-time">
                            {formatDateTime(row.at)}
                          </td>
                          <td><span className={`health-log-dot health-log-dot--${row.db === "ok" ? "ok" : "error"}`} />{row.db}</td>
                          <td><span className={`health-log-dot health-log-dot--${row.r2 === "ok" ? "ok" : "error"}`} />{row.r2}</td>
                          <td><span className={`health-log-dot health-log-dot--${row.ws === "ok" ? "ok" : "warn"}`} />{row.ws}</td>
                          <td><span className={`health-log-dot health-log-dot--${row.crons === "ok" ? "ok" : "error"}`} />{row.crons}</td>
                          <td>
                            <span className="health-log-latency">
                              <span className={`health-log-latency-bar health-log-latency-bar--${band}`} style={{ width: `${barWidth}%`, minWidth: 4, maxWidth: 40 }} />
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
        </Paper>
      </SimpleGrid>

      {/* ── API Test Console ────────────────────────── */}
      <div className="api-console">
        <div className="api-console__header">
          <div className="api-console__header-left">
            <Group gap={8} wrap="nowrap">
              <Text fw={700} size="sm">{t("status.section.apiTests")}</Text>
              <Badge size="xs" variant="default">{t("status.api.endpointCount", { count: totalEndpoints })}</Badge>
            </Group>

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
                h={44}
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

        <div className="api-console__progress-track">
          <div
            className={`api-console__progress-fill${runningAll ? " api-console__progress-fill--running" : ""}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

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
      </div>

      {/* ── Debug Console ─────────────────────────── */}
      <AdminApiDebugConsole logs={debugLogs} onClear={clearDebug} />
    </Stack>
  );
}
