import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ShieldIcon,
  SwordsIcon,
  UsersIcon,
} from "../icons";

export type DashboardAttentionSummary = {
  startsSoon: number;
  conflicts: number;
  full: number;
  quotaShortfalls: number;
};

export function DashboardAttentionCard({
  summary,
  loading,
  onBrowse,
}: {
  summary: DashboardAttentionSummary;
  loading: boolean;
  onBrowse: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const total = summary.startsSoon + summary.conflicts + summary.full + summary.quotaShortfalls;
  const items = [
    { key: "startsSoon", value: summary.startsSoon, icon: <CalendarDaysIcon size={17} aria-hidden="true" /> },
    { key: "conflicts", value: summary.conflicts, icon: <ShieldIcon size={17} aria-hidden="true" /> },
    { key: "full", value: summary.full, icon: <UsersIcon size={17} aria-hidden="true" /> },
    { key: "quotaShortfalls", value: summary.quotaShortfalls, icon: <SwordsIcon size={17} aria-hidden="true" /> },
  ].filter((item) => item.value > 0);

  return (
    <Card className="dashboard-attention gap-0 py-0">
      <div className="dashboard-attention__heading">
        <div>
          <p className="dashboard-command__eyebrow">{t("attention.eyebrow")}</p>
          <h2>{t("attention.title")}</h2>
        </div>
        {loading ? <Skeleton className="dashboard-attention__count-skeleton" /> : (
          <span className={total > 0 ? "dashboard-attention__count dashboard-attention__count--active" : "dashboard-attention__count"}>
            {total}
          </span>
        )}
      </div>
      <div className="dashboard-attention__list">
        {loading ? (
          <div className="dashboard-attention__skeletons">
            <Skeleton className="dashboard-attention__row-skeleton" />
            <Skeleton className="dashboard-attention__row-skeleton" />
          </div>
        ) : items.length > 0 ? items.map((item) => (
          <div key={item.key} className="dashboard-attention__item">
            <span>{item.icon}</span>
            <div>
              <strong>{t(`attention.${item.key}.title`, { count: item.value })}</strong>
              <small>{t(`attention.${item.key}.description`)}</small>
            </div>
            <b>{item.value}</b>
          </div>
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
      <Button variant="ghost" className="dashboard-attention__action" onClick={onBrowse}>
        <span>{t("attention.openEvents")}</span>
        <ArrowRightIcon size={15} aria-hidden="true" />
      </Button>
    </Card>
  );
}
