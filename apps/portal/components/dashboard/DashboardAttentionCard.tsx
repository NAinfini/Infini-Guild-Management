import { Card } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import { formatEventTime, formatLocaleDate } from "@portal/utils/datetime";
import { useTranslation } from "react-i18next";
import {
  CalendarDaysIcon,
  ShieldIcon,
  SwordsIcon,
  UsersIcon,
} from "../icons";
import { getDashboardAttentionKinds, type DashboardAttentionKind } from "./dashboard-page-data";
import type { DashboardUpcomingEventRow } from "./shared";

export type DashboardAttentionSummary = {
  startsSoon: number;
  conflicts: number;
  full: number;
  quotaShortfalls: number;
};

export function DashboardAttentionCard({
  rows,
  loading,
}: {
  rows: DashboardUpcomingEventRow[];
  loading: boolean;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const icons: Record<DashboardAttentionKind, React.ReactNode> = {
    startsSoon: <CalendarDaysIcon size={14} aria-hidden="true" />,
    conflicts: <ShieldIcon size={14} aria-hidden="true" />,
    full: <UsersIcon size={14} aria-hidden="true" />,
    quotaShortfalls: <SwordsIcon size={14} aria-hidden="true" />,
  };
  const items = rows
    .map((row) => ({ row, kinds: getDashboardAttentionKinds(row) }))
    .filter((item) => item.kinds.length > 0);

  return (
    <Card className="dashboard-attention gap-0 py-0">
      <div className="dashboard-attention__heading">
        <h2>{t("attention.title")}</h2>
        {loading ? <Skeleton className="dashboard-attention__count-skeleton" /> : (
          <span className={items.length > 0 ? "dashboard-attention__count dashboard-attention__count--active" : "dashboard-attention__count"}>
            {t("attention.eventCount", { count: items.length })}
          </span>
        )}
      </div>
      <div className="dashboard-attention__list">
        {loading ? (
          <div className="dashboard-attention__skeletons">
            <Skeleton className="dashboard-attention__row-skeleton" />
            <Skeleton className="dashboard-attention__row-skeleton" />
          </div>
        ) : items.length > 0 ? items.map(({ row, kinds }) => (
          <article key={row.item.id} className="dashboard-attention__item">
            <div className="dashboard-attention__event">
              <h3>{row.item.title}</h3>
              <time dateTime={row.item.start_at}>
                <CalendarDaysIcon size={13} aria-hidden="true" />
                {formatLocaleDate(row.item.start_at, i18n.language, "short")}
                <span aria-hidden="true">·</span>
                {formatEventTime(row.item.start_at, i18n.language)}
              </time>
            </div>
            <div className="dashboard-attention__signals" aria-label={t("attention.reasons")}>
              {kinds.map((kind) => (
                <span key={kind} className="dashboard-attention__signal" data-kind={kind}>
                  {icons[kind]}
                  <span>{t(`attention.${kind}.title`)}</span>
                  {kind === "full" ? <b>{row.capacityLabel}</b> : null}
                  {kind === "quotaShortfalls" && row.quotaSummary ? (
                    <b>{row.quotaSummary.matchedTotal}/{row.quotaSummary.requiredTotal}</b>
                  ) : null}
                </span>
              ))}
            </div>
          </article>
        )) : (
          <div className="dashboard-attention__ready">
            <ShieldIcon size={20} aria-hidden="true" />
            <div>
              <strong>{t("attention.ready.title")}</strong>
              <small>{t("attention.ready.description")}</small>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
