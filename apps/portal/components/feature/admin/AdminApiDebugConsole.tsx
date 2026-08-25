import { ChevronRightIcon, ClipboardIcon, TrashIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { copyPlainText } from "@portal/utils/copy";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatClock } from "@portal/utils/datetime";
import { EmptyState } from "../../shared/EmptyState";
import { type DebugLogEntry } from "./AdminApiTestEngine";
import "./AdminApiTest.css";

type DebugFilter = "all" | "errors" | "slow";

export function formatLogEntry(entry: DebugLogEntry): string {
  const statusStr = entry.status !== null ? String(entry.status) : isOptionalSkip(entry) ? "N/A" : "ERR";
  const errorStr = entry.error ? ` | ERROR: ${entry.error}` : "";
  const header = `[${entry.ranAt}] ${entry.method} ${entry.path} → ${statusStr} (${entry.latencyMs}ms)${errorStr}`;
  if (!entry.body) return header;
  return `${header}\n${entry.body}`;
}

function dotCls(status: number | null): string {
  if (status === null) return "api-debug__row-dot--err";
  if (status >= 200 && status < 300) return "api-debug__row-dot--ok";
  if (status >= 400) return "api-debug__row-dot--err";
  return "api-debug__row-dot--warn";
}

function isOptionalSkip(entry: DebugLogEntry): boolean {
  return entry.skipped === true && entry.error === null;
}

function statusRowCls(status: number | null): string {
  if (status === null) return "api-debug__row-status--err";
  if (status >= 200 && status < 300) return "api-debug__row-status--ok";
  if (status >= 400) return "api-debug__row-status--err";
  return "api-debug__row-status--warn";
}

function isError(entry: DebugLogEntry): boolean {
  return !isOptionalSkip(entry) && (entry.status === null || entry.status >= 400);
}

function isSlow(entry: DebugLogEntry): boolean {
  return entry.latencyMs >= 300;
}

function DebugRow({ entry }: { entry: DebugLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const hasBody = !!entry.body;
  const errorRow = isError(entry);
  const rowContent = (
    <>
      <span className={`api-debug__row-dot ${isOptionalSkip(entry) ? "api-debug__row-dot--warn" : dotCls(entry.status)}`} />
      <span className={`api-debug__row-method api-debug__row-method--${entry.method}`}>
        {entry.method}
      </span>
      <span className="api-debug__row-path">{entry.path}</span>
      <span className={`api-debug__row-status ${isOptionalSkip(entry) ? "api-debug__row-status--warn" : statusRowCls(entry.status)}`}>
        {entry.status ?? (isOptionalSkip(entry) ? "N/A" : "ERR")}
      </span>
      <span className="api-debug__row-latency">{entry.latencyMs}ms</span>
      <span className="api-debug__row-time">{formatClock(entry.ranAt, { seconds: true })}</span>
      {hasBody ? (
        <span className={`api-debug__row-chevron ${expanded ? "api-debug__row-chevron--open" : ""}`}>
          <ChevronRightIcon size={11} />
        </span>
      ) : <span style={{ width: 14 }} />}
    </>
  );

  return (
    <div className={`api-debug__row ${errorRow ? "api-debug__row--error" : ""}`}>
      {hasBody ? (
        <button
          type="button"
          className="api-debug__row-main"
          aria-label={`${entry.method} ${entry.path}`}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {rowContent}
        </button>
      ) : (
        <div className="api-debug__row-main api-debug__row-main--static">
          {rowContent}
        </div>
      )}
      {entry.error && !expanded ? (
        <div className="api-debug__row-error">{entry.error}</div>
      ) : null}
      {expanded && entry.body ? (
        <div id={bodyId} className="api-debug__row-body">
          <pre>{entry.body}</pre>
        </div>
      ) : null}
    </div>
  );
}

export function AdminApiDebugConsole({
  logs,
  onClear,
}: {
  logs: DebugLogEntry[];
  onClear: () => void;
}) {
  const { t } = useTranslation("admin");
  const bodyRef = useRef<HTMLDivElement>(null);
  const filterName = useId();
  const [filter, setFilter] = useState<DebugFilter>("all");

  const copyAll = useCallback(() => {
    const text = logs.map(formatLogEntry).join("\n\n" + "─".repeat(80) + "\n\n");
    void copyPlainText(text);
  }, [logs]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length]);

  const filteredLogs = filter === "all"
    ? logs
    : filter === "errors"
      ? logs.filter(isError)
      : logs.filter(isSlow);

  const errorCount = logs.filter(isError).length;
  const slowCount = logs.filter(isSlow).length;

  return (
    <div className="admin-panel api-debug">
      <div className="admin-panel__head">
        <div className="api-debug__header-main">
          <div className="admin-panel__title">
            <span>{t("status.api.debugTitle")}</span>
            <span className="admin-count">{logs.length}</span>
          </div>

          {logs.length > 0 ? (
            <div className="api-filter" role="group" aria-label={t("status.api.filter.results")}>
              {([
                { label: t("status.api.filter.all"), value: "all" },
                {
                  label: `${t("status.api.filter.errors")}${errorCount > 0 ? ` (${errorCount})` : ""}`,
                  value: "errors",
                },
                {
                  label: `${t("status.api.filter.slow")}${slowCount > 0 ? ` (${slowCount})` : ""}`,
                  value: "slow",
                },
              ] satisfies Array<{ label: string; value: DebugFilter }>).map((option) => (
                <label
                  className="api-filter__option"
                  data-active={filter === option.value || undefined}
                  key={option.value}
                >
                  <input
                    className="api-filter__input"
                    type="radio"
                    name={filterName}
                    value={option.value}
                    checked={filter === option.value}
                    onChange={() => setFilter(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <div className="api-debug__header-right">
          <Tooltip>
            <TooltipTrigger render={(
              <Button
                className="api-debug__action"
                size="icon"
                variant="ghost"
                onClick={copyAll}
                disabled={logs.length === 0}
                aria-label={t("status.api.copyAll")}
              />
            )}>
              <ClipboardIcon size={14} />
            </TooltipTrigger>
            <TooltipContent className="api-debug__tooltip">
              <strong>{t("status.api.copyAll")}</strong>
              <span>{t("status.api.tooltip.copyAll")}</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={(
              <Button
                className="api-debug__action"
                size="icon"
                variant="destructive"
                onClick={onClear}
                disabled={logs.length === 0}
                aria-label={t("status.api.clearDebug")}
              />
            )}>
              <TrashIcon size={14} />
            </TooltipTrigger>
            <TooltipContent className="api-debug__tooltip">
              <strong>{t("status.api.clearDebug")}</strong>
              <span>{t("status.api.tooltip.clearDebug")}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="api-debug__body" ref={bodyRef}>
        {filteredLogs.length === 0 ? (
          <EmptyState
            className="admin-empty"
            title={logs.length === 0
              ? t("status.api.debugEmpty")
              : t(filter === "errors" ? "status.api.noErrors" : "status.api.noSlow")}
          />
        ) : (
          filteredLogs.map((entry) => (
            <DebugRow key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
