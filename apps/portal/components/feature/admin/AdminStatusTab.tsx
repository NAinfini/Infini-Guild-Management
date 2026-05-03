import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ProgressButton } from "@portal/components/effects";
import { PortalCard } from "../../shared/PortalCard";
import { ClipboardIcon, PlayIcon } from "@portal/components/icons";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { userCanViewStatus } from "../../../utils/permissions";
import { formatDateTime } from "../../../utils/admin";
import { AdminSystemSection } from "./AdminSystemSection";
import {
  API_TEST_GAP_GET_MS,
  API_TEST_GAP_MUTATION_MS,
  buildApiCategories,
  captureContextFromResponse,
  createInitialTestRunContext,
  nextLogId,
  prepareEndpointRequest,
  readRetryAfterSeconds,
  runEndpointTest,
  truncateJson,
  waitWithAbort,
  type CategoryDef,
  type DebugLogEntry,
  type EndpointResult,
  type TestRunContext,
} from "./AdminApiTestEngine";
import { ApiTestCategory } from "./AdminApiTestCategory";
import { AdminApiDebugConsole } from "./AdminApiDebugConsole";

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
  const apiCategories = useMemo(() => buildApiCategories(t), [t]);
  const user = useAuthStore((state) => state.user);
  const isAdmin = userCanViewStatus(user);
  const loadErrorMessage = tc("loadError");
  const heading = <Title order={3} style={{ margin: 0, fontSize: 16 }}>{t("tab.status")}</Title>;
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [runningSet, setRunningSet] = useState<Set<string>>(new Set());
  const [resultMap, setResultMap] = useState<Map<string, EndpointResult>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const contextRef = useRef<TestRunContext>(createInitialTestRunContext());

  const pushLog = useCallback((entry: DebugLogEntry) => {
    setDebugLogs((prev) => [...prev, entry]);
  }, []);

  const clearRunConsole = useCallback(() => {
    setDebugLogs([]);
    if (typeof window !== "undefined" && window.console?.clear) {
      window.console.clear();
    }
  }, []);

  const runCategoryInternal = useCallback(async (category: CategoryDef, signal: AbortSignal) => {
    const epKeys = category.endpoints.map((ep) => `${ep.method}-${ep.path}`);
    setRunningSet((prev) => {
      const next = new Set(prev);
      for (const k of epKeys) next.add(k);
      return next;
    });

    for (const ep of category.endpoints) {
      if (signal.aborted) break;
      const key = `${ep.method}-${ep.path}`;
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
      });
    }

    setRunningSet((prev) => {
      const next = new Set(prev);
      for (const k of epKeys) next.delete(k);
      return next;
    });
  }, [pushLog]);

  const runCategory = useCallback(async (category: CategoryDef) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    clearRunConsole();
    await runCategoryInternal(category, controller.signal);
  }, [clearRunConsole, runCategoryInternal]);

  const [runningAll, setRunningAll] = useState(false);

  const runCleanup = useCallback(async (signal: AbortSignal) => {
    const ctx = contextRef.current;
    const cleanupSteps: Array<{ label: string; method: string; path: string; jsonBody?: unknown }> = [];

    // Order: dependents first, then parents
    // Gallery image (the uploaded image that survived the in-category delete of the video)
    if (ctx.createdGalleryImageId) {
      cleanupSteps.push({ label: "Cleanup: Gallery Image", method: "DELETE", path: `/api/gallery/${encodeURIComponent(ctx.createdGalleryImageId)}` });
    }
    // Announcement (archive = soft delete)
    if (ctx.createdAnnouncementId) {
      cleanupSteps.push({ label: "Cleanup: Announcement", method: "DELETE", path: `/api/announcements/${encodeURIComponent(ctx.createdAnnouncementId)}` });
    }
    // Wiki article before category (article depends on category)
    if (ctx.createdWikiArticleId) {
      cleanupSteps.push({ label: "Cleanup: Wiki Article", method: "DELETE", path: `/api/wiki/articles/${encodeURIComponent(ctx.createdWikiArticleId)}` });
    }
    if (ctx.createdWikiCategoryId) {
      cleanupSteps.push({ label: "Cleanup: Wiki Category", method: "DELETE", path: `/api/wiki/categories/${encodeURIComponent(ctx.createdWikiCategoryId)}` });
    }
    // Guild war history
    if (ctx.createdWarHistoryId) {
      cleanupSteps.push({ label: "Cleanup: War History", method: "DELETE", path: `/api/guild-war/history/${encodeURIComponent(ctx.createdWarHistoryId)}` });
    }
    // Invite link
    if (ctx.createdInviteLinkId) {
      cleanupSteps.push({ label: "Cleanup: Invite Link", method: "DELETE", path: `/api/admin/invite-links/${encodeURIComponent(ctx.createdInviteLinkId)}` });
    }
    // Admin role
    if (ctx.createdRoleId) {
      cleanupSteps.push({ label: "Cleanup: Admin Role", method: "DELETE", path: `/api/admin/roles/${encodeURIComponent(ctx.createdRoleId)}` });
    }
    // Restore modified profile to original values
    if (ctx.targetUserId && ctx.targetProfileSnapshot) {
      cleanupSteps.push({
        label: "Cleanup: Restore Profile",
        method: "PATCH",
        path: `/api/users/${encodeURIComponent(ctx.targetUserId)}/profile`,
        jsonBody: {
          bio: ctx.targetProfileSnapshot.bio,
          classes: ctx.targetProfileSnapshot.classes,
        },
      });
    }
    // Delete registered test user (batch delete via admin)
    if (ctx.registeredUserId) {
      cleanupSteps.push({
        label: "Cleanup: Registered User",
        method: "PATCH",
        path: "/api/admin/users/batch/delete",
        jsonBody: { user_ids: [ctx.registeredUserId] },
      });
    }
    // Delete admin-created test user (batch delete via admin)
    if (ctx.adminCreatedUserId && ctx.adminCreatedUserId !== ctx.registeredUserId) {
      cleanupSteps.push({
        label: "Cleanup: Admin Created User",
        method: "PATCH",
        path: "/api/admin/users/batch/delete",
        jsonBody: { user_ids: [ctx.adminCreatedUserId] },
      });
    }

    for (const step of cleanupSteps) {
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
        };
        if (step.jsonBody !== undefined) {
          fetchOpts.headers = { "Content-Type": "application/json" };
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
      }
    }
  }, [pushLog]);

  const runAllCategories = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    clearRunConsole();
    setResultMap(new Map());
    contextRef.current = createInitialTestRunContext();
    setRunningAll(true);
    try {
      for (const cat of apiCategories) {
        if (controller.signal.aborted) break;
        await runCategoryInternal(cat, controller.signal);
      }
      // Cleanup phase: delete test-created objects
      if (!controller.signal.aborted) {
        await runCleanup(controller.signal);
      }
    } finally {
      setRunningAll(false);
    }
  }, [clearRunConsole, runCategoryInternal, runCleanup]);

  const clearDebug = useCallback(() => {
    setDebugLogs([]);
    setResultMap(new Map());
    contextRef.current = createInitialTestRunContext();
  }, []);

  if (!isAdmin) {
    return (
      <Stack gap={12}>
        {heading}
        <Alert color="yellow" title={t("adminOnly")} />
      </Stack>
    );
  }

  const totalEndpoints = apiCategories.reduce((sum, cat) => sum + cat.endpoints.length, 0);
  const completedEndpoints = Math.min(resultMap.size, totalEndpoints);
  const progressPercent = totalEndpoints > 0 ? (completedEndpoints / totalEndpoints) * 100 : 0;

  return (
    <Stack gap={16}>
      {heading}

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

        <PortalCard interactive={false} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "1.2rem", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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
            <ScrollArea style={{ flex: 1 }}>
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
                      <th>Crons</th>
                      <th>Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusHealthLogs.map((row, index) => {
                      const latency = row.latencyMs ?? 0;
                      const barWidth = Math.min(100, (latency / 500) * 100);
                      const barColor = latency < 200 ? "#10b981" : latency < 400 ? "#eab308" : "#ef4444";
                      return (
                        <tr key={`${row.at}-${index}`}>
                          <td style={{ color: "color-mix(in srgb, var(--color-text, #111827) 65%, transparent)" }}>
                            {formatDateTime(row.at)}
                          </td>
                          <td><span className={`health-log-dot health-log-dot--${row.db === "ok" ? "ok" : "error"}`} />{row.db}</td>
                          <td><span className={`health-log-dot health-log-dot--${row.r2 === "ok" ? "ok" : "error"}`} />{row.r2}</td>
                          <td><span className={`health-log-dot health-log-dot--${row.ws === "ok" ? "ok" : "warn"}`} />{row.ws}</td>
                          <td><span className={`health-log-dot health-log-dot--${row.crons === "ok" ? "ok" : "error"}`} />{row.crons}</td>
                          <td>
                            <span className="health-log-latency">
                              <span className="health-log-latency-bar" style={{ width: `${barWidth}%`, minWidth: 4, maxWidth: 40, background: barColor }} />
                              <span style={{ color: barColor, fontWeight: 600 }}>{row.latencyMs ?? "—"}ms</span>
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

      {/* ── API Test Panels ───────────────────────── */}
      <PortalCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Group justify="space-between" mb={4}>
            <Group gap={8}>
              <Text fw={600} size="sm">{t("status.section.apiTests")}</Text>
              <Badge size="xs" variant="default">{t("status.api.endpointCount", { count: totalEndpoints })}</Badge>
            </Group>
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
          </Group>
          <Text c="dimmed" size="xs" mb={12}>{t("status.section.apiTestsHint")}</Text>
          <Accordion variant="separated" multiple>
            {apiCategories.map((cat) => (
              <Accordion.Item key={cat.key} value={cat.key}>
                <Accordion.Control>
                  <Group gap={8}>
                    <Text fw={500} size="sm">{cat.label}</Text>
                    <Badge size="xs" variant="default">
                      {cat.endpoints.length}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <ApiTestCategory
                    category={cat}
                    onRunCategory={runCategory}
                    runningSet={runningSet}
                    resultMap={resultMap}
                    runLabel={t("status.api.runCategory")}
                  />
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
          <Stack gap={6} mt={12}>
            <Group justify="space-between" gap={8}>
              <Text c="dimmed" size="xs">{t("status.api.progress")}</Text>
              <Text c="dimmed" size="xs">{completedEndpoints}/{totalEndpoints}</Text>
            </Group>
            <Progress value={progressPercent} size="sm" radius="xl" striped={runningAll} animated={runningAll} />
          </Stack>
        </div>
      </PortalCard>

      {/* ── Debug Console ─────────────────────────── */}
      <AdminApiDebugConsole logs={debugLogs} onClear={clearDebug} />
    </Stack>
  );
}
