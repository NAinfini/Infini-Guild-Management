import { RingProgress } from "@mantine/core";
import { ProgressButton } from "@portal/components/effects";
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
import { type ComponentType, useState } from "react";
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

function epKey(ep: EndpointDef): string {
  return `${ep.method}-${ep.path}`;
}

function statusCls(status: number | null): string {
  if (status === null) return "api-ep__status--skip";
  if (status >= 200 && status < 300) return "api-ep__status--ok";
  if (status >= 400 && status < 500) return "api-ep__status--warn";
  return "api-ep__status--err";
}

function progressColor(allPassed: boolean, hasFail: boolean): string {
  if (hasFail) return "#ef4444";
  if (allPassed) return "#10b981";
  return "#3b82f6";
}

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
            <span className={`api-ep__status ${statusCls(result.status)}`}>
              {result.status ?? "ERR"}
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
}: {
  category: CategoryDef;
  onRunCategory: (cat: CategoryDef) => Promise<void>;
  runningSet: Set<string>;
  resultMap: Map<string, EndpointResult>;
}) {
  const [open, setOpen] = useState(false);

  const catRunning = category.endpoints.some((ep) => runningSet.has(epKey(ep)));
  const catDone = category.endpoints.filter((ep) => resultMap.has(epKey(ep))).length;
  const catTotal = category.endpoints.length;
  const allPassed = catDone === catTotal && catDone > 0 && category.endpoints.every((ep) => {
    const r = resultMap.get(epKey(ep));
    return r && r.status !== null && r.status >= 200 && r.status < 400;
  });
  const hasFail = category.endpoints.some((ep) => {
    const r = resultMap.get(epKey(ep));
    return r && (r.status === null || r.status >= 400);
  });
  const pct = catTotal > 0 ? Math.round((catDone / catTotal) * 100) : 0;

  let avgLatency = 0;
  let latencyCount = 0;
  for (const ep of category.endpoints) {
    const r = resultMap.get(epKey(ep));
    if (r) {
      avgLatency += r.latencyMs;
      latencyCount++;
    }
  }
  avgLatency = latencyCount > 0 ? Math.round(avgLatency / latencyCount) : 0;

  const Icon = CATEGORY_ICONS[category.key] ?? DatabaseIcon;

  const accentCls = catRunning
    ? "api-cat__accent--running"
    : catDone === 0 ? "" : catDone < catTotal ? "api-cat__accent--partial" : allPassed ? "api-cat__accent--pass" : "api-cat__accent--fail";

  const statusDot = catDone === 0
    ? null
    : allPassed
      ? "api-cat__status-dot--pass"
      : hasFail
        ? "api-cat__status-dot--fail"
        : "api-cat__status-dot--partial";

  const ringColor = progressColor(allPassed, hasFail);

  const shouldAutoOpen = catRunning || (catDone > 0 && catDone < catTotal);
  const isOpen = open || shouldAutoOpen;

  return (
    <div className="api-cat">
      <div className={`api-cat__accent ${accentCls}`} />

      <div className="api-cat__row" onClick={() => setOpen((p) => !p)}>
        <div className={`api-cat__chevron ${isOpen ? "api-cat__chevron--open" : ""}`}>
          <ChevronRightIcon size={13} />
        </div>

        <div className="api-cat__icon">
          <Icon size={15} />
        </div>

        <span className="api-cat__name">{category.label}</span>

        {catDone > 0 ? (
          <RingProgress
            className="api-cat__ring"
            size={28}
            thickness={3}
            roundCaps
            sections={[{ value: pct, color: ringColor }]}
          />
        ) : null}

        <span className="api-cat__fraction">{catDone}/{catTotal}</span>
        {catDone > 0 ? <span className="api-cat__pct">{pct}%</span> : null}
        {latencyCount > 0 ? <span className="api-cat__avg-latency">{avgLatency}ms</span> : null}
        {statusDot ? <span className={`api-cat__status-dot ${statusDot}`} /> : null}

        <span className="api-cat__spacer" />

        <div className="api-cat__actions" onClick={(e) => e.stopPropagation()}>
          {catRunning ? <span className="api-ep__running" /> : null}
          <ProgressButton
            onPress={() => onRunCategory(category)}
            disabled={catRunning}
          >
            <PlayIcon size={11} />
          </ProgressButton>
        </div>
      </div>

      {catDone > 0 || catRunning ? (
        <div className="api-cat__progress-track">
          <div
            className="api-cat__progress-fill"
            style={{ width: `${pct}%`, background: ringColor }}
          />
        </div>
      ) : null}

      {isOpen ? (
        <div className="api-cat__endpoints">
          {category.endpoints.map((ep) => (
            <EndpointRow
              key={epKey(ep)}
              endpoint={ep}
              running={runningSet.has(epKey(ep))}
              result={resultMap.get(epKey(ep)) ?? null}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
