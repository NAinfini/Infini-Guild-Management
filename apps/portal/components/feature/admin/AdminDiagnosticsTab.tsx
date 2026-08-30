import { Alert, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { PlayIcon } from "@portal/components/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { userCanViewStatus } from "../../../utils/permissions";
import { AdminApiDebugConsole } from "./AdminApiDebugConsole";
import { AdminDataIntegrityTool } from "./AdminDataIntegrityTool";
import { ApiTestCategory } from "./AdminApiTestCategory";
import { buildApiCategories, filterApiCategoriesForPermissions } from "./AdminApiTestEngine";
import { useAdminApiTestRunner } from "./useAdminApiTestRunner";
import "./AdminApiTest.css";
import "./AdminDiagnosticsTab.css";

export function AdminDiagnosticsTab() {
  const { t } = useTranslation("admin");
  const user = useAuthStore((state) => state.user);
  const apiCategories = useMemo(() => buildApiCategories(t), [t]);
  const visibleApiCategories = useMemo(
    () => filterApiCategoriesForPermissions(apiCategories, user?.permissions),
    [apiCategories, user?.permissions],
  );
  const {
    debugLogs,
    runningSet,
    resultMap,
    runningAll,
    runningCritical,
    selectedSuiteEndpointTotal,
    runCategory,
    runAllCategories,
    runCriticalCategories,
    clearDebug,
    stop,
  } = useAdminApiTestRunner(visibleApiCategories, user);

  if (!userCanViewStatus(user)) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("adminOnly")}</AlertTitle>
      </Alert>
    );
  }

  const totalEndpoints = visibleApiCategories.reduce((sum, category) => sum + category.endpoints.length, 0);
  const progressTotal = selectedSuiteEndpointTotal || totalEndpoints;
  const completedEndpoints = Math.min(resultMap.size, progressTotal);
  const progressPercent = progressTotal > 0 ? (completedEndpoints / progressTotal) * 100 : 0;
  const isRunning = runningAll || runningCritical || runningSet.size > 0;
  const hasProgress = isRunning || completedEndpoints > 0;

  let passedEndpoints = 0;
  let failedEndpoints = 0;
  for (const result of resultMap.values()) {
    if (result.skipped && result.error === null) passedEndpoints++;
    else if (result.status !== null && result.status >= 200 && result.status < 400) passedEndpoints++;
    else failedEndpoints++;
  }

  return (
    <div className="admin-diagnostics">
      <div className="admin-diagnostics__workspace">
        <section className="admin-panel api-console admin-diagnostics__console" aria-label={t("status.section.apiTests")}>
          <div className={`admin-panel__head api-console__header${hasProgress ? " api-console__header--with-progress" : ""}`}>
            <div className="api-console__header-left">
              <div className="admin-panel__title">
                <span>{t("status.section.apiTests")}</span>
                <span className="admin-count">
                  {t("status.api.endpointCount", { count: progressTotal })}
                </span>
              </div>

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

              <p className="api-console__hint">
                {t("status.api.criticalHint")}
              </p>
            </div>

            <div className="api-console__header-actions">
              {isRunning ? (
                <Button className="api-console__stop" variant="destructive" onClick={stop}>
                  {t("status.api.stop")}
                </Button>
              ) : null}
              <Button
                className="api-console__run-critical"
                variant="outline"
                onClick={() => { void runCriticalCategories(); }}
                loading={runningCritical}
                disabled={isRunning}
              >
                <PlayIcon size={14} data-icon="inline-start" />
                {t("status.quickCheck")}
              </Button>
              <Button
                className="api-console__run-all"
                onClick={() => { void runAllCategories(); }}
                loading={runningAll}
                disabled={isRunning}
              >
                <PlayIcon size={14} data-icon="inline-start" />
                {t("status.api.runAll")}
              </Button>
            </div>
          </div>

          {hasProgress ? (
            <div className="api-console__progress-track">
              <div
                className={`api-console__progress-fill${isRunning ? " api-console__progress-fill--running" : ""}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          ) : null}

          <div className="api-cat-list">
            <div className="api-cat-list__head" aria-hidden="true">
              <span>{t("status.api.column.category")}</span>
              <span>{t("status.api.column.endpoints")}</span>
              <span>{t("status.api.pass")}</span>
              <span>{t("status.api.fail")}</span>
              <span>{t("status.api.column.averageLatency")}</span>
              <span>{t("status.api.column.state")}</span>
              <span />
            </div>
            {visibleApiCategories.map((category) => (
              <ApiTestCategory
                key={category.key}
                category={category}
                onRunCategory={runCategory}
                runningSet={runningSet}
                resultMap={resultMap}
              />
            ))}
          </div>
        </section>

        <AdminApiDebugConsole logs={debugLogs} onClear={clearDebug} clearDisabled={isRunning} />
        <AdminDataIntegrityTool />
      </div>
    </div>
  );
}
