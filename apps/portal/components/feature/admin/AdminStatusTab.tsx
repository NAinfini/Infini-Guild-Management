import {
  Alert,
  Badge,
  Button,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { ProgressButton } from "@portal/components/effects";
import { PortalCard } from "../../shared/PortalCard";
import { ClipboardIcon, PlayIcon } from "@portal/components/icons";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { useNotificationStore } from "../../../stores/notifications";
import { userCanViewStatus } from "../../../utils/permissions";
import { formatDateTime } from "../../../utils/admin";
import { AdminSystemSection } from "./AdminSystemSection";
import {
  API_TEST_GAP_GET_MS,
  API_TEST_GAP_MUTATION_MS,
  buildApiCategories,
  buildCleanupSteps,
  captureContextFromResponse,
  countStaleSystemTestArtifacts,
  createInitialTestRunContext,
  filterApiCategoriesForPermissions,
  nextLogId,
  prepareEndpointRequest,
  readRetryAfterSeconds,
  runEndpointTest,
  STALE_ARTIFACT_PROBES,
  SYSTEM_TEST_AUDIT_HEADER,
  SYSTEM_TEST_HEADER,
  SYSTEM_TEST_HEADER_VALUE,
  truncateJson,
  waitWithAbort,
  type CategoryDef,
  type DebugLogEntry,
  type EndpointResult,
  type TestRunContext,
} from "./AdminApiTestEngine";
import { ApiTestCategory, epKey } from "./AdminApiTestCategory";
import { AdminApiDebugConsole } from "./AdminApiDebugConsole";
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

/*
 * Upper bound on teardown. Teardown is deliberately not cancellable by the test
 * run's abort signal, so it needs its own escape hatch to avoid hanging the UI
 * if the worker stops responding mid-cleanup.
 */
const TEARDOWN_TIMEOUT_MS = 120_000;

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
  const setSuppressed = useNotificationStore((state) => state.setSuppressed);
  const isAdmin = userCanViewStatus(user);
  const loadErrorMessage = tc("loadError");
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [runningSet, setRunningSet] = useState<Set<string>>(new Set());
  const [resultMap, setResultMap] = useState<Map<string, EndpointResult>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const contextRef = useRef<TestRunContext>(createInitialTestRunContext());
  const runLogRef = useRef<DebugLogEntry[]>([]);
  // Resolves when the previous run has finished its teardown, not merely its requests.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const pushLog = useCallback((entry: DebugLogEntry) => {
    runLogRef.current = [...runLogRef.current, entry];
    setDebugLogs((prev) => [...prev, entry]);
  }, []);

  const clearRunConsole = useCallback(() => {
    runLogRef.current = [];
    setDebugLogs([]);
    if (typeof window !== "undefined" && window.console?.clear) {
      window.console.clear();
    }
  }, []);

  const runCategoryInternal = useCallback(async (category: CategoryDef, signal: AbortSignal) => {
    const epKeys = category.endpoints.map((ep) => epKey(category.key, ep));
    setRunningSet((prev) => {
      const next = new Set(prev);
      for (const k of epKeys) next.add(k);
      return next;
    });

    for (const ep of category.endpoints) {
      if (signal.aborted) break;
      const key = epKey(category.key, ep);
      const prepared = prepareEndpointRequest(ep, contextRef.current);

      const requestGapMs = ep.method === "GET" ? API_TEST_GAP_GET_MS : API_TEST_GAP_MUTATION_MS;
      await waitWithAbort(requestGapMs, signal);
      if (signal.aborted) {
        break;
      }

      setRunningSet((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });

      let result = await runEndpointTest(ep, prepared, signal);
      if (result.status === 429) {
        const retryAfterSeconds = readRetryAfterSeconds(result.parsedJson);
        if (retryAfterSeconds !== null) {
          await waitWithAbort((retryAfterSeconds + 1) * 1000, signal);
          if (!signal.aborted) {
            result = await runEndpointTest(ep, prepared, signal);
          }
        }
      }

      if (signal.aborted) break;
      contextRef.current = captureContextFromResponse(contextRef.current, ep, result);

      setResultMap((prev) => {
        const next = new Map(prev);
        next.set(key, result);
        return next;
      });

      setRunningSet((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });

      pushLog({
        id: nextLogId(),
        category: category.label,
        label: ep.label,
        method: ep.method,
        path: prepared.path,
        status: result.status,
        latencyMs: result.latencyMs,
        error: result.error,
        body: result.body,
        ranAt: result.ranAt,
        skipped: result.skipped,
      });
    }

    setRunningSet((prev) => {
      const next = new Set(prev);
      for (const k of epKeys) next.delete(k);
      return next;
    });
  }, [pushLog]);

  const [runningAll, setRunningAll] = useState(false);

  const runCleanup = useCallback(async (signal: AbortSignal) => {
    const cleanupSteps = buildCleanupSteps(contextRef.current);
    let failed = 0;

    for (const step of cleanupSteps) {
      /*
       * Note this signal is the teardown's own, never the test run's — see
       * runTeardown. Aborting a run must not abort the deletion of what that
       * run already wrote to the database.
       */
      if (signal.aborted) break;
      await waitWithAbort(API_TEST_GAP_MUTATION_MS, signal);
      if (signal.aborted) break;

      const started = performance.now();
      const ranAt = new Date().toISOString();
      try {
        const fetchOpts: RequestInit = {
          method: step.method,
          credentials: "include",
          signal,
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
            [SYSTEM_TEST_AUDIT_HEADER]: "suppress",
            ...(step.jsonBody !== undefined ? { "Content-Type": "application/json" } : {}),
          },
        };
        if (step.jsonBody !== undefined) {
          fetchOpts.body = JSON.stringify(step.jsonBody);
        }
        const response = await fetch(step.path, fetchOpts);
        const latencyMs = Math.round(performance.now() - started);
        let body = "";
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("json")) {
          const raw = await response.text();
          if (raw) body = JSON.stringify(JSON.parse(raw), null, 2);
        } else {
          body = await response.text();
        }
        pushLog({
          id: nextLogId(),
          category: "Cleanup",
          label: step.label,
          method: step.method,
          path: step.path,
          status: response.status,
          latencyMs,
          error: response.ok ? null : `${response.status} ${response.statusText}`,
          body: truncateJson(body),
          ranAt,
        });
        if (response.ok && step.clearContext) {
          contextRef.current = { ...contextRef.current, ...step.clearContext };
        }
        if (!response.ok) {
          failed += 1;
        }
      } catch (err) {
        if (signal.aborted) break;
        const latencyMs = Math.round(performance.now() - started);
        pushLog({
          id: nextLogId(),
          category: "Cleanup",
          label: step.label,
          method: step.method,
          path: step.path,
          status: null,
          latencyMs,
          error: err instanceof Error ? err.message : "Unknown error",
          body: "",
          ranAt,
        });
        failed += 1;
      }
    }

    /*
     * A failed DELETE used to be one red row among ~200 log lines. Rows left
     * behind in a production database deserve their own verdict, so report the
     * count instead of making the operator go find it.
     */
    return { attempted: cleanupSteps.length, failed };
  }, [pushLog]);

  const runStaleArtifactScan = useCallback(async (signal: AbortSignal) => {
    for (const probe of STALE_ARTIFACT_PROBES) {
      if (signal.aborted) break;
      const started = performance.now();
      const ranAt = new Date().toISOString();
      try {
        const response = await fetch(probe.path, {
          method: "GET",
          credentials: "include",
          signal,
          headers: {
            [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
            [SYSTEM_TEST_AUDIT_HEADER]: "suppress",
          },
        });
        const latencyMs = Math.round(performance.now() - started);
        const raw = await response.text();
        let parsed: unknown = null;
        let body = raw;
        if (raw && (response.headers.get("content-type") ?? "").includes("json")) {
          parsed = JSON.parse(raw) as unknown;
          body = JSON.stringify(parsed, null, 2);
        }
        const staleCount = response.ok ? countStaleSystemTestArtifacts(parsed) : 0;
        pushLog({
          id: nextLogId(),
          category: "Stale Data",
          label: `Stale [systemtest] ${probe.label}`,
          method: "GET",
          path: probe.path,
          status: response.status,
          latencyMs,
          error: response.ok && staleCount === 0 ? null : response.ok ? `${staleCount} stale artifact(s) need manual cleanup` : `${response.status} ${response.statusText}`,
          body: response.ok
            ? truncateJson(JSON.stringify({ stale_count: staleCount, manual_cleanup_required: staleCount > 0 }, null, 2))
            : truncateJson(body),
          ranAt,
        });
      } catch (err) {
        if (signal.aborted) break;
        const latencyMs = Math.round(performance.now() - started);
        pushLog({
          id: nextLogId(),
          category: "Stale Data",
          label: `Stale [systemtest] ${probe.label}`,
          method: "GET",
          path: probe.path,
          status: null,
          latencyMs,
          error: err instanceof Error ? err.message : "Unknown error",
          body: "",
          ranAt,
        });
      }
    }
  }, [pushLog]);

  /*
   * Teardown runs on its own controller, never the test run's. Whatever stopped
   * the run — the operator hitting stop, or another run starting — must not stop
   * us deleting the rows that run already wrote to the production database. Only
   * the hard timeout below can cancel it.
   */
  const runTeardown = useCallback(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEARDOWN_TIMEOUT_MS);
    const ranAt = new Date().toISOString();
    try {
      const outcome = await runCleanup(controller.signal);
      await runStaleArtifactScan(controller.signal);
      const incomplete = outcome.failed > 0 || controller.signal.aborted;
      const verdict = incomplete
        ? "TEARDOWN INCOMPLETE — test rows may remain in the database"
        : "Teardown complete — every test row was deleted";
      /*
       * The verdict has to go in `path`: that is the column DebugRow renders as
       * the row's text, and `label` is never displayed anywhere. `skipped` on the
       * success case is what gives the row a neutral "N/A" badge instead of the
       * red ERR that a null status would otherwise paint on a clean teardown.
       */
      pushLog({
        id: nextLogId(),
        category: "Cleanup",
        label: verdict,
        method: "—",
        path: verdict,
        status: null,
        skipped: !incomplete,
        latencyMs: 0,
        error: incomplete
          ? `${outcome.failed}/${outcome.attempted} cleanup step(s) failed${controller.signal.aborted ? " (timed out)" : ""} — search the log for Cleanup rows in red`
          : null,
        body: JSON.stringify({ attempted: outcome.attempted, failed: outcome.failed }, null, 2),
        ranAt,
      });
    } finally {
      clearTimeout(timer);
    }
  }, [pushLog, runCleanup, runStaleArtifactScan]);

  /*
   * Aborts the in-flight run and waits for its teardown to finish before the
   * caller touches contextRef — otherwise the new run resets the ids the old
   * run still needs in order to delete its own rows.
   */
  const beginRun = useCallback(async () => {
    abortRef.current?.abort();
    const previous = inFlightRef.current;
    if (previous) {
      await previous.catch(() => undefined);
    }
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  const writeSystemTestAuditSummary = useCallback(async (logs: DebugLogEntry[], signal: AbortSignal) => {
    const endpointLogs = logs.filter((entry) => entry.category !== "Cleanup" && entry.category !== "Stale Data");
    const failed = endpointLogs.filter((entry) =>
      entry.error !== null || entry.status === null || entry.status >= 400,
    );
    const payload = {
      total: endpointLogs.length,
      passed: endpointLogs.length - failed.length,
      failed: failed.length,
      errors: failed.map((entry) => ({
        category: entry.category,
        label: entry.label,
        method: entry.method,
        path: entry.path,
        status: entry.status,
        error: entry.error,
      })),
    };
    await fetch("/api/admin/status/system-test-audit", {
      method: "POST",
      credentials: "include",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
        [SYSTEM_TEST_AUDIT_HEADER]: "summary",
      },
      body: JSON.stringify(payload),
    });
  }, []);

  const runCategory = useCallback(async (category: CategoryDef) => {
    const controller = await beginRun();
    clearRunConsole();
    setSuppressed(true);
    // Teardown lives in `finally`: an aborted run still has rows to delete.
    const run = (async () => {
      try {
        await runCategoryInternal(category, controller.signal);
      } finally {
        await runTeardown();
        setSuppressed(false);
      }
    })();
    inFlightRef.current = run;
    await run;
  }, [beginRun, clearRunConsole, runCategoryInternal, runTeardown, setSuppressed]);

  const runAllCategories = useCallback(async () => {
    const controller = await beginRun();
    clearRunConsole();
    setResultMap(new Map());
    contextRef.current = createInitialTestRunContext();
    setRunningAll(true);
    setSuppressed(true);
    const run = (async () => {
      try {
        for (const cat of visibleApiCategories) {
          if (controller.signal.aborted) break;
          await runCategoryInternal(cat, controller.signal);
        }
      } finally {
        await runTeardown();
        // Summary is written after teardown so it reflects the cleanup outcome.
        const summaryController = new AbortController();
        const summaryTimer = setTimeout(() => summaryController.abort(), TEARDOWN_TIMEOUT_MS);
        try {
          await writeSystemTestAuditSummary(runLogRef.current, summaryController.signal);
        } finally {
          clearTimeout(summaryTimer);
        }
        setRunningAll(false);
        setSuppressed(false);
      }
    })();
    inFlightRef.current = run;
    await run;
  }, [beginRun, clearRunConsole, runCategoryInternal, runTeardown, setSuppressed, visibleApiCategories, writeSystemTestAuditSummary]);

  const clearDebug = useCallback(() => {
    runLogRef.current = [];
    setDebugLogs([]);
    setResultMap(new Map());
    contextRef.current = createInitialTestRunContext();
  }, []);

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

  return (
    <Stack gap={16}>

      {/* ── System Health ─────────────────────────── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <PortalCard interactive={false}>
          <div style={{ padding: "1.2rem" }}>
            <Text fw={600} size="sm" mb={12}>{t("status.section.health")}</Text>
            <AdminSystemSection
              statusLoading={statusLoading}
              statusError={statusError}
              loadErrorMessage={loadErrorMessage}
              statusData={statusData}
              statusLatencyMs={statusLatencyMs}
            />
          </div>
        </PortalCard>

        <PortalCard interactive={false}>
          <div style={{ padding: "1.2rem" }}>
            <Group justify="space-between" mb={12}>
              <Text fw={600} size="sm">{t("status.healthLogs.title")}</Text>
              <Button
                size="compact-xs"
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
                      // 三段离散状态（好/警/差），不是连续值，按 task-8-brief.md Step 3.4
                      // 的要求切换预定义类，不拼接颜色字符串。200/400ms 两个阈值仍与
                      // AdminSystemSection.tsx 重复——那张表的合并是批 C 的范围，这里只搬
                      // 颜色，不动判断逻辑。
                      const latencyBand = latency < 200 ? "good" : latency < 400 ? "warn" : "bad";
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
                              <span className={`health-log-latency-bar health-log-latency-bar--${latencyBand}`} style={{ width: `${barWidth}%`, minWidth: 4, maxWidth: 40 }} />
                              <span className={`health-log-latency-value health-log-latency-value--${latencyBand}`}>{row.latencyMs ?? "—"}ms</span>
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
        </PortalCard>
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
                  pass
                </span>
                {failedEndpoints > 0 ? (
                  <span className="api-console__stat">
                    <span className="api-console__stat-dot api-console__stat-dot--fail" />
                    <span className="api-console__stat-value">{failedEndpoints}</span>
                    fail
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <ProgressButton
            onPress={runAllCategories}
            loadingLabel={t("status.api.runAll")}
            successLabel={t("status.api.runAll")}
            errorLabel={t("status.api.runAll")}
            indicator="spinner"
            disabled={runningAll}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <PlayIcon size={14} />
              <span>{t("status.api.runAll")}</span>
            </span>
          </ProgressButton>
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
