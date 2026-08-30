import { Card } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";

type DashboardPanelSkeletonVariant = "signups" | "events" | "war";

const FOUR_SLOTS = [0, 1, 2, 3] as const;
const EIGHT_SLOTS = [...FOUR_SLOTS, 4, 5, 6, 7] as const;

export function DashboardPanelSkeleton({ variant }: { variant: DashboardPanelSkeletonVariant }) {
  return (
    <Card
      className={`dashboard-card dashboard-panel-skeleton dashboard-panel-skeleton--${variant} gap-0 py-0`}
      data-variant={variant}
      aria-busy="true"
    >
      <div className="dashboard-panel-skeleton__content">
        <div className="dashboard-panel-skeleton__heading">
          <Skeleton className="dashboard-panel-skeleton__heading-icon" />
          <Skeleton className="dashboard-panel-skeleton__heading-text" />
        </div>

        {variant === "signups" ? (
          <div className="dashboard-panel-skeleton__calendar">
            {EIGHT_SLOTS.map((slot) => (
              <div className="dashboard-panel-skeleton__day" key={slot}>
                <Skeleton className="dashboard-panel-skeleton__day-label" />
                <Skeleton className="dashboard-panel-skeleton__day-event" />
              </div>
            ))}
          </div>
        ) : variant === "events" ? (
          <div className="dashboard-panel-skeleton__event-rows">
            {FOUR_SLOTS.map((slot) => (
              <div className="dashboard-panel-skeleton__event-row" key={slot}>
                <Skeleton className="dashboard-panel-skeleton__event-date" />
                <div className="dashboard-panel-skeleton__event-copy">
                  <Skeleton className="dashboard-panel-skeleton__event-title" />
                  <Skeleton className="dashboard-panel-skeleton__event-meta" />
                </div>
                <Skeleton className="dashboard-panel-skeleton__event-tail" />
              </div>
            ))}
          </div>
        ) : (
          <div className="dashboard-panel-skeleton__war">
            <div className="dashboard-panel-skeleton__war-summary">
              <div className="dashboard-panel-skeleton__war-copy">
                <Skeleton className="dashboard-panel-skeleton__war-title" />
                <Skeleton className="dashboard-panel-skeleton__war-meta" />
              </div>
              <Skeleton className="dashboard-panel-skeleton__war-badge" />
            </div>
            <div className="dashboard-panel-skeleton__war-stats">
              {FOUR_SLOTS.map((slot) => (
                <div className="dashboard-panel-skeleton__war-stat" key={slot}>
                  <Skeleton className="dashboard-panel-skeleton__war-label" />
                  <Skeleton className="dashboard-panel-skeleton__war-bar" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
