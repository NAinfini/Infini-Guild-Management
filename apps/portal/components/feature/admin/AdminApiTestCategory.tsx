import {
  AlertTriangleIcon,
  BoltIcon,
  BookTextIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FileSearchIcon,
  GalleryThumbnailsIcon,
  KeyIcon,
  LinkIcon,
  PlayIcon,
  ShieldIcon,
  SpeakerphoneIcon,
  SwordsIcon,
  TrophyIcon,
  UsersIcon,
} from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { type ComponentType, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CategoryDef, type EndpointResult, type EndpointDef } from "./AdminApiTestEngine";
import "./AdminApiTest.css";

const CATEGORY_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  system: DatabaseIcon,
  auth: KeyIcon,
  users: UsersIcon,
  events: CalendarDaysIcon,
  announcements: SpeakerphoneIcon,
  gallery: GalleryThumbnailsIcon,
  guildWar: SwordsIcon,
  wiki: BookTextIcon,
  adminInvites: LinkIcon,
  adminAudit: FileSearchIcon,
  adminUsers: ShieldIcon,
  adminRoles: BoltIcon,
  badges: TrophyIcon,
  adminErrorLog: AlertTriangleIcon,
};

export function epKey(catKey: string, ep: EndpointDef): string {
  return `${catKey}:${ep.method}-${ep.path}`;
}

function statusCls(status: number | null): string {
  if (status === null) return "api-ep__status--skip";
  if (status >= 200 && status < 300) return "api-ep__status--ok";
  if (status >= 400 && status < 500) return "api-ep__status--warn";
  return "api-ep__status--err";
}

function isOptionalSkip(result: EndpointResult | null): boolean {
  return result?.skipped === true && result.error === null;
}

export function isEndpointError(result: EndpointResult | null | undefined): boolean {
  return result !== null
    && result !== undefined
    && !isOptionalSkip(result)
    && (result.status === null || result.status >= 400);
}

type ProgressState = "pass" | "fail" | "pending";

function progressState(allPassed: boolean, hasFail: boolean): ProgressState {
  if (hasFail) return "fail";
  if (allPassed) return "pass";
  return "pending";
}

// Exported so the CSS parity test keeps every category progress state on one palette.
export const PROGRESS_STATE_COLOR_VAR: Record<ProgressState, string> = {
  fail: "var(--status-danger)",
  pass: "var(--status-success)",
  pending: "var(--brand-fill)",
};

function EndpointRow({
  endpoint,
  running,
  result,
}: {
  endpoint: EndpointDef;
  running: boolean;
  result: EndpointResult | null;
}) {
  return (
    <div className="api-ep">
      <span className={`api-ep__method api-ep__method--${endpoint.method}`}>
        {endpoint.method}
      </span>
      <span className="api-ep__label">{endpoint.label}</span>
      <div className="api-ep__right">
        {result ? (
          <>
            <span className={`api-ep__status ${isOptionalSkip(result) ? "api-ep__status--warn" : statusCls(result.status)}`}>
              {result.status ?? (isOptionalSkip(result) ? "N/A" : "ERR")}
            </span>
            <span className="api-ep__latency">{result.latencyMs}ms</span>
          </>
        ) : null}
        {running ? <span className="api-ep__running" /> : null}
      </div>
    </div>
  );
}

export function ApiTestCategory({
  category,
  onRunCategory,
  runningSet,
  resultMap,
  showOnlyErrors = false,
}: {
  category: CategoryDef;
  onRunCategory: (cat: CategoryDef) => Promise<void>;
  runningSet: Set<string>;
  resultMap: Map<string, EndpointResult>;
  showOnlyErrors?: boolean;
}) {
  const { t } = useTranslation("admin");
  const [open, setOpen] = useState(false);
  const endpointsId = useId();

  const anyCategoryRunning = runningSet.size > 0;
  const catRunning = category.endpoints.some((ep) => runningSet.has(epKey(category.key, ep)));
  const catDone = category.endpoints.filter((ep) => resultMap.has(epKey(category.key, ep))).length;
  const catTotal = category.endpoints.length;
  const allPassed = catDone === catTotal && catDone > 0 && category.endpoints.every((ep) => {
    const r = resultMap.get(epKey(category.key, ep));
    return r && (isOptionalSkip(r) || r.status !== null && r.status >= 200 && r.status < 400);
  });
  const hasFail = category.endpoints.some((ep) => {
    return isEndpointError(resultMap.get(epKey(category.key, ep)));
  });
  const pct = catTotal > 0 ? Math.round((catDone / catTotal) * 100) : 0;

  let catPassed = 0;
  let catFailed = 0;
  for (const endpoint of category.endpoints) {
    const result = resultMap.get(epKey(category.key, endpoint));
    if (!result) continue;
    if (isEndpointError(result)) catFailed++;
    else catPassed++;
  }

  let avgLatency = 0;
  let latencyCount = 0;
  for (const ep of category.endpoints) {
    const r = resultMap.get(epKey(category.key, ep));
    if (r) {
      avgLatency += r.latencyMs;
      latencyCount++;
    }
  }
  avgLatency = latencyCount > 0 ? Math.round(avgLatency / latencyCount) : 0;

  const Icon = CATEGORY_ICONS[category.key] ?? DatabaseIcon;

  const statusDot = catDone === 0
    ? null
    : allPassed
      ? "api-cat__status-dot--pass"
      : hasFail
        ? "api-cat__status-dot--fail"
        : "api-cat__status-dot--partial";

  const progressStateValue = progressState(allPassed, hasFail);
  const statusLabel = catRunning
    ? t("status.api.state.running")
    : catDone === 0
      ? t("status.api.state.notRun")
      : allPassed
        ? t("status.api.state.passed")
        : hasFail
          ? t("status.api.state.failed")
          : t("status.api.state.incomplete");

  useEffect(() => {
    if (anyCategoryRunning) setOpen(false);
  }, [anyCategoryRunning]);

  const isOpen = catRunning || (!anyCategoryRunning && open);
  const displayedEndpoints = showOnlyErrors
    ? category.endpoints.filter((ep) => isEndpointError(resultMap.get(epKey(category.key, ep))))
    : category.endpoints;

  return (
    <div className="api-cat">
      <div className="api-cat__row">
        <button
          type="button"
          className="api-cat__toggle"
          aria-expanded={isOpen}
          aria-controls={endpointsId}
          aria-label={`${category.label}: ${catDone}/${catTotal}`}
          disabled={anyCategoryRunning}
          onClick={() => setOpen((previous) => !previous)}
        >
          <span className="api-cat__identity">
            <span className={`api-cat__chevron ${isOpen ? "api-cat__chevron--open" : ""}`}>
              <ChevronRightIcon size={13} />
            </span>
            <span className="api-cat__icon"><Icon size={15} /></span>
            <span className="api-cat__name">{category.label}</span>
          </span>
          <span className="api-cat__metric api-cat__metric--total">{catTotal}</span>
          <span className="api-cat__metric api-cat__metric--pass">{catPassed}</span>
          <span className="api-cat__metric api-cat__metric--fail">{catFailed}</span>
          <span className="api-cat__metric api-cat__avg-latency">
            {latencyCount > 0 ? `${avgLatency} ms` : "—"}
          </span>
          <span className={`api-cat__state api-cat__state--${progressStateValue}`}>
            {statusDot ? <span className={`api-cat__status-dot ${statusDot}`} /> : null}
            {statusLabel}
          </span>
        </button>

        <div className="api-cat__actions">
          {catRunning ? <span className="api-ep__running" /> : null}
          <Button
            className="api-cat__run-button"
            aria-label={category.label}
            onClick={() => { void onRunCategory(category); }}
            disabled={catRunning}
            loading={catRunning}
            variant="secondary"
            size="icon-sm"
          >
            <PlayIcon size={14} />
          </Button>
        </div>
      </div>

      {catDone > 0 || catRunning ? (
        <div className="api-cat__progress-track">
          <div
            className={`api-cat__progress-fill api-cat__progress-fill--${progressStateValue}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      {isOpen ? (
        <div id={endpointsId} className="api-cat__endpoints">
          {displayedEndpoints.map((ep) => (
            <EndpointRow
              key={epKey(category.key, ep)}
              endpoint={ep}
              running={runningSet.has(epKey(category.key, ep))}
              result={resultMap.get(epKey(category.key, ep)) ?? null}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
