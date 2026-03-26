import { useCallback, useEffect, useState } from "react";

export type StatusHealthLog = {
  at: string;
  db: string;
  r2: string;
  ws: string;
  crons: string;
  latencyMs: number | null;
};

const STORAGE_KEY = "admin.status.health.logs";
const LOG_LIMIT = 10;

type UseAdminStatusControllerParams = {
  statusQuery: { refetch: () => Promise<{ data?: { db: string; r2: string; ws: string; crons: string } }> };
  activeTab: string;
  isAdmin: boolean;
};

export function useAdminStatusController({
  statusQuery,
  activeTab,
  isAdmin,
}: UseAdminStatusControllerParams) {
  const [statusLatencyMs, setStatusLatencyMs] = useState<number | null>(null);
  const [statusHealthLogs, setStatusHealthLogs] = useState<StatusHealthLog[]>([]);

  // Load persisted health logs on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const next = parsed
          .filter((item) => item && typeof item === "object")
          .map((item) => item as StatusHealthLog)
          .slice(0, LOG_LIMIT);
        setStatusHealthLogs(next);
      }
    } catch {
      // ignore invalid persisted logs
    }
  }, []);

  // Persist health logs to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(statusHealthLogs.slice(0, LOG_LIMIT)));
    } catch {
      // ignore storage write errors
    }
  }, [statusHealthLogs]);

  const refreshStatus = useCallback(async () => {
    const started = performance.now();
    const result = await statusQuery.refetch();
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    setStatusLatencyMs(latencyMs);
    const status = result.data;
    if (status) {
      setStatusHealthLogs((current) =>
        [
          {
            at: new Date().toISOString(),
            db: status.db,
            r2: status.r2,
            ws: status.ws,
            crons: status.crons,
            latencyMs,
          },
          ...current,
        ].slice(0, LOG_LIMIT),
      );
    }
    return result;
  }, [statusQuery.refetch]);

  // Poll every 30s when status tab is active
  useEffect(() => {
    if (!isAdmin || activeTab !== "status") return;
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeTab, isAdmin, refreshStatus]);

  return { statusLatencyMs, statusHealthLogs, refreshStatus };
}
