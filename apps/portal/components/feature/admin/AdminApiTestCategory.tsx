import { ActionIcon, RingProgress } from "@mantine/core";
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
import { type ComponentType, useId, useState } from "react";
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

type ProgressState = "pass" | "fail" | "pending";

function progressState(allPassed: boolean, hasFail: boolean): ProgressState {
  if (hasFail) return "fail";
  if (allPassed) return "pass";
  return "pending";
}

/*
 * RingProgress 的 color prop 只吃字面字符串，不认 className——但字面字符串
 * 不一定要是 hex。Mantine 对无法识别成内置色名的字符串会原样透传（见
 * node_modules/@mantine/core esm/components/RingProgress/Curve/Curve.mjs:41
 * 的 `getThemeColor(color, theme)` 和 parse-theme-color.mjs:68-75：
 * `_color in theme.colors` 为 false 时 `variable` 是 undefined，
 * `getThemeColor` 直接把原串塞进 `--curve-color`；再由 RingProgress 自带的
 * CSS `stroke: var(--curve-color, var(--rp-curve-root-color))` 消费），
 * 所以这里直接写 var() 字符串，三态本身仍然穷举、不是拼接颜色。
 *
 * 这个结论只对 RingProgress/Curve 这条路径成立，不要照抄到别的组件：
 * Curve 从不读 parsed.isLight。凡是走 Mantine 的
 * defaultVariantColorsResolver（Badge、Button、Alert…）都会读这个字段，
 * 而 luminance.mjs:26-28 的 isLightColor 第一行就是
 * `if (color.startsWith("var(")) return false`——任何 var() 字符串一律
 * 判定为「暗色」，不管它实际解析出来是深是浅。这只在组件的
 * autoContrast 为真时才会真正选错前景色（filled 变体靠这个字段挑黑/白字），
 * 本仓库 ThemeProvider.tsx 里已把 autoContrast 整体移除、没有任何调用点
 * 显式传它（已 grep 确认），所以目前没有组件会踩到；但这只是当前配置下
 * 恰好没触发，不是这条写法本身安全，别的地方要用同样的 var() 字符串前
 * 应该重新核实 autoContrast 状态。
 *
 * 另外，本仓库 task-5/6b 复盘过 `rgba("portal-bronze", 0.1)` 让 Alert
 * 底色变黑的事故，但那是一个不以 "var(" 开头的裸色名落进了
 * to-rgba.mjs 认不出格式就返回黑色的兜底分支；核实当前 Mantine 版本，
 * rgba.mjs:7-9 / darken.mjs:3-4 / lighten.mjs:3-4 三个函数都显式判断
 * `color.startsWith("var(")` 并改用 color-mix() 处理，根本不会调用
 * toRgba——所以字面 var() 字符串不会重演那次「变黑」，Badge/Alert 这类
 * 组件上真正的风险是上一段说的 isLight 误判，不是变黑。
 */
// 导出（而不只是模块内 const）是因为 AdminApiTestCategory.test.ts 里的守卫
// 断言要拿它跟 AdminApiTest.css 的 .api-cat__progress-fill--* 逐值比对，
// 防止两份同义 token 表悄悄漂移（the final colour review M3）。
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
}: {
  category: CategoryDef;
  onRunCategory: (cat: CategoryDef) => Promise<void>;
  runningSet: Set<string>;
  resultMap: Map<string, EndpointResult>;
}) {
  const [open, setOpen] = useState(false);
  const endpointsId = useId();

  const catRunning = category.endpoints.some((ep) => runningSet.has(epKey(category.key, ep)));
  const catDone = category.endpoints.filter((ep) => resultMap.has(epKey(category.key, ep))).length;
  const catTotal = category.endpoints.length;
  const allPassed = catDone === catTotal && catDone > 0 && category.endpoints.every((ep) => {
    const r = resultMap.get(epKey(category.key, ep));
    return r && (isOptionalSkip(r) || r.status !== null && r.status >= 200 && r.status < 400);
  });
  const hasFail = category.endpoints.some((ep) => {
    const r = resultMap.get(epKey(category.key, ep));
    return r && !isOptionalSkip(r) && (r.status === null || r.status >= 400);
  });
  const pct = catTotal > 0 ? Math.round((catDone / catTotal) * 100) : 0;

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

  const progressStateValue = progressState(allPassed, hasFail);
  const ringColor = PROGRESS_STATE_COLOR_VAR[progressStateValue];

  const shouldAutoOpen = catRunning || (catDone > 0 && catDone < catTotal);
  const isOpen = open || shouldAutoOpen;

  return (
    <div className="api-cat">
      <div className={`api-cat__accent ${accentCls}`} />

      <div className="api-cat__row">
        <button
          type="button"
          className="api-cat__toggle"
          aria-expanded={isOpen}
          aria-controls={endpointsId}
          aria-label={`${category.label}: ${catDone}/${catTotal}`}
          onClick={() => setOpen((previous) => !previous)}
        >
          <span className={`api-cat__chevron ${isOpen ? "api-cat__chevron--open" : ""}`}>
            <ChevronRightIcon size={13} />
          </span>

          <span className="api-cat__icon">
            <Icon size={15} />
          </span>

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
        </button>

        <div className="api-cat__actions">
          {catRunning ? <span className="api-ep__running" /> : null}
          <ActionIcon
            className="api-cat__run-button"
            aria-label={category.label}
            onClick={() => { void onRunCategory(category); }}
            disabled={catRunning}
            loading={catRunning}
            variant="light"
            size={44}
          >
            <PlayIcon size={11} />
          </ActionIcon>
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
          {category.endpoints.map((ep) => (
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
