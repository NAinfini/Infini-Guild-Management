import { useCallback, useRef, useState } from "react";
import type { User } from "@guild/shared";
import { useNotificationStore } from "../../../stores/notifications";
import {
  API_TEST_GAP_GET_MS,
  API_TEST_GAP_MUTATION_MS,
  buildSystemTestSummary,
  captureContextFromResponse,
  createInitialTestRunContext,
  nextLogId,
  prepareEndpointRequest,
  readRetryAfterSeconds,
  requestSystemTestCleanup,
  runEndpointTest,
  SYSTEM_TEST_AUDIT_HEADER,
  SYSTEM_TEST_HEADER,
  SYSTEM_TEST_HEADER_VALUE,
  SYSTEM_TEST_RUN_ID_HEADER,
  truncateJson,
  waitWithAbort,
  type CategoryDef,
  type DebugLogEntry,
  type EndpointResult,
  type TestRunContext,
} from "./AdminApiTestEngine";
import { epKey } from "./AdminApiTestCategory";

/*
 * Upper bound on teardown. Teardown is deliberately not cancellable by the test
 * run's abort signal, so it needs its own escape hatch to avoid hanging the UI
 * if the worker stops responding mid-cleanup.
 */
const TEARDOWN_TIMEOUT_MS = 120_000;
const TEARDOWN_RETRY_MS = 250;

type AdminApiTestActor = Pick<User, "id" | "username" | "role_level" | "permissions">;

export function useAdminApiTestRunner(
  visibleApiCategories: CategoryDef[],
  actor: AdminApiTestActor | null,
) {
  const setSuppressed = useNotificationStore((state) => state.setSuppressed);
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

      const runId = contextRef.current.runId;
      if (!runId) throw new Error("System-test run was not initialized");
      let result = await runEndpointTest(ep, prepared, runId, signal);
      if (result.status === 429) {
        const retryAfterSeconds = readRetryAfterSeconds(result.parsedJson);
        if (retryAfterSeconds !== null) {
          await waitWithAbort((retryAfterSeconds + 1) * 1000, signal);
          if (!signal.aborted) {
            result = await runEndpointTest(ep, prepared, runId, signal);
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
    const runId = contextRef.current.runId;
    if (!runId) return { attempted: 0, failed: 1 };
    const started = performance.now();
    const ranAt = new Date().toISOString();
    const result = await requestSystemTestCleanup(runId, signal);
    pushLog({
      id: nextLogId(),
      category: "Cleanup",
      label: "Server run cleanup",
      method: "POST",
      path: "system-test run registry",
      status: result.status,
      latencyMs: Math.round(performance.now() - started),
      error: result.error,
      body: truncateJson(result.body),
      ranAt,
    });
    return { attempted: 1, failed: result.error === null ? 0 : 1 };
  }, [pushLog]);

  /*
   * Teardown runs on its own controller, never the test run's. Whatever stopped
   * the run — the operator hitting stop, or another run starting — must not stop
   * us deleting the rows that run already wrote to the production database. Only
   * the hard timeout below can cancel it.
   */
  const runTeardown = useCallback(async (): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEARDOWN_TIMEOUT_MS);
    const ranAt = new Date().toISOString();
    try {
      const outcome = await runCleanup(controller.signal);
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
      return !incomplete;
    } finally {
      clearTimeout(timer);
    }
  }, [pushLog, runCleanup]);

  const finalizeServerRun = useCallback(async (allowAlreadyFinalized = false): Promise<boolean> => {
    const runId = contextRef.current.runId;
    if (!runId) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEARDOWN_TIMEOUT_MS);
    const started = performance.now();
    const ranAt = new Date().toISOString();
    try {
      let status: number | null = null;
      let body = "";
      let errorMessage: string | null = null;
      let mayAlreadyBeFinalized = allowAlreadyFinalized;
      for (let attempt = 1; attempt <= 3 && !controller.signal.aborted; attempt += 1) {
        try {
          const response = await fetch(
            `/api/admin/status/system-test-runs/${encodeURIComponent(runId)}/finalize`,
            {
              method: "POST",
              credentials: "include",
              signal: controller.signal,
              headers: { "X-Requested-With": "XMLHttpRequest" },
            },
          );
          status = response.status;
          body = await response.text();
          if (response.status === 404 && mayAlreadyBeFinalized) {
            status = 204;
            body = "System-test run was already finalized";
            errorMessage = null;
            break;
          }
          errorMessage = response.ok ? null : `${response.status} ${response.statusText}`;
          if (response.ok) break;
        } catch (error) {
          mayAlreadyBeFinalized = true;
          errorMessage = error instanceof Error ? error.message : "Unknown error";
        }
        if (attempt < 3) await waitWithAbort(TEARDOWN_RETRY_MS, controller.signal);
      }
      pushLog({
        id: nextLogId(),
        category: "Cleanup",
        label: "Server run finalize",
        method: "POST",
        path: "system-test run registry finalize",
        status,
        latencyMs: Math.round(performance.now() - started),
        error: errorMessage,
        body: truncateJson(body),
        ranAt,
      });
      return errorMessage === null && status !== null && status >= 200 && status < 300;
    } finally {
      clearTimeout(timer);
    }
  }, [pushLog]);

  /*
   * Aborts the in-flight run and waits for its teardown to finish before the
   * caller touches contextRef — otherwise the new run resets IDs the previous
   * run still needs to delete its own rows.
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

  const writeSystemTestAuditSummary = useCallback(async (
    logs: DebugLogEntry[],
    signal: AbortSignal,
  ): Promise<"completed" | "not_completed" | "unknown"> => {
    const runId = contextRef.current.runId;
    if (!runId) return "not_completed";
    const payload = buildSystemTestSummary(logs);
    try {
      const response = await fetch("/api/admin/status/system-test-audit", {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
          [SYSTEM_TEST_AUDIT_HEADER]: "summary",
          [SYSTEM_TEST_RUN_ID_HEADER]: runId,
        },
        body: JSON.stringify(payload),
      });
      return response.ok ? "completed" : "not_completed";
    } catch {
      return "unknown";
    }
  }, []);

  const createServerRun = useCallback(async (signal: AbortSignal): Promise<{ runId: string; fixtureId: string }> => {
    const response = await fetch("/api/admin/status/system-test-runs", { method: "POST", credentials: "include", signal, headers: { "X-Requested-With": "XMLHttpRequest" } });
    const body = await response.json() as { run_id?: unknown; fixture_id?: unknown };
    if (!response.ok || typeof body.run_id !== "string" || typeof body.fixture_id !== "string") {
      throw new Error("Could not create system-test run");
    }
    return { runId: body.run_id, fixtureId: body.fixture_id };
  }, []);

  const runCategory = useCallback(async (category: CategoryDef) => {
    const controller = await beginRun();
    clearRunConsole();
    setResultMap(new Map());
    const serverRun = await createServerRun(controller.signal);
    contextRef.current = {
      ...createInitialTestRunContext(),
      ...serverRun,
      meId: actor?.id ?? null,
      meUsername: actor?.username ?? null,
      meRoleLevel: actor?.role_level ?? null,
      mePermissions: actor?.permissions ?? null,
    };
    setSuppressed(true);
    // Teardown lives in `finally`: an aborted run still has rows to delete.
    const run = (async () => {
      try {
        await runCategoryInternal(category, controller.signal);
      } finally {
        try {
          const cleaned = await runTeardown();
          if (cleaned) await finalizeServerRun();
        } finally {
          setSuppressed(false);
        }
      }
    })();
    inFlightRef.current = run;
    await run;
  }, [actor, beginRun, clearRunConsole, createServerRun, finalizeServerRun, runCategoryInternal, runTeardown, setSuppressed]);

  const runAllCategories = useCallback(async () => {
    const controller = await beginRun();
    clearRunConsole();
    setResultMap(new Map());
    const serverRun = await createServerRun(controller.signal);
    contextRef.current = {
      ...createInitialTestRunContext(),
      ...serverRun,
      meId: actor?.id ?? null,
      meUsername: actor?.username ?? null,
      meRoleLevel: actor?.role_level ?? null,
      mePermissions: actor?.permissions ?? null,
    };
    setRunningAll(true);
    setSuppressed(true);
    const run = (async () => {
      try {
        for (const cat of visibleApiCategories) {
          if (controller.signal.aborted) break;
          await runCategoryInternal(cat, controller.signal);
        }
      } finally {
        try {
          const cleaned = await runTeardown();
          if (cleaned) {
            // Summary finalization atomically writes one normal audit summary
            // and removes the private run UUID. If it fails, delete the empty
            // completed run without a summary instead.
            const summaryController = new AbortController();
            const summaryTimer = setTimeout(() => summaryController.abort(), TEARDOWN_TIMEOUT_MS);
            let summaryOutcome: "completed" | "not_completed" | "unknown" = "unknown";
            try {
              summaryOutcome = await writeSystemTestAuditSummary(runLogRef.current, summaryController.signal);
            } finally {
              clearTimeout(summaryTimer);
            }
            if (summaryOutcome !== "completed") {
              await finalizeServerRun(summaryOutcome === "unknown");
            }
          }
        } finally {
          setRunningAll(false);
          setSuppressed(false);
        }
      }
    })();
    inFlightRef.current = run;
    await run;
  }, [actor, beginRun, clearRunConsole, createServerRun, finalizeServerRun, runCategoryInternal, runTeardown, setSuppressed, visibleApiCategories, writeSystemTestAuditSummary]);

  const clearDebug = useCallback(() => {
    runLogRef.current = [];
    setDebugLogs([]);
    setResultMap(new Map());
    contextRef.current = createInitialTestRunContext();
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    debugLogs,
    runningSet,
    resultMap,
    runningAll,
    runCategory,
    runAllCategories,
    clearDebug,
    stop,
  };
}
