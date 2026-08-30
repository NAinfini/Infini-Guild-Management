import {
  FlagIcon,
  GemIcon,
  ShieldIcon,
  SwordsIcon,
  TargetArrowIcon,
} from "@portal/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { flexRender } from "@tanstack/react-table";
import type { DataTableInstance } from "@portal/components/shared/data-table-features";
import type { HistoryMemberStat } from "@portal/types/guild-war";

export type ComparisonMetric = {
  id: string;
  label: string;
  own: number;
  enemy: number;
};

export function WarHistoryMemberCards({
  detailTable,
  label,
}: {
  detailTable: DataTableInstance<HistoryMemberStat>;
  label: string;
}) {
  const headersByColumnId = new Map(
    detailTable.getFlatHeaders().map((header) => [header.column.id, header]),
  );

  return (
    <div className="whd-member-cards" role="list" aria-label={label}>
      {detailTable.getRowModel().rows.map((row) => (
        <article
          key={row.id}
          className="whd-member-card"
          role="listitem"
          data-testid={`war-history-member-card-${row.original.user_id}`}
        >
          <dl className="whd-member-card__fields">
            {row.getVisibleCells().map((cell) => {
              const header = headersByColumnId.get(cell.column.id);
              return (
                <div
                  key={cell.id}
                  className="whd-member-card__field"
                  data-column-id={cell.column.id}
                >
                  <dt className="whd-member-card__label">
                    {header && !header.isPlaceholder
                      ? flexRender(header.column.columnDef.header, header.getContext())
                      : cell.column.id}
                  </dt>
                  <dd className="whd-member-card__value">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </dd>
                </div>
              );
            })}
          </dl>
        </article>
      ))}
    </div>
  );
}

export function MetricColumn({
  id,
  label,
  own,
  enemy,
  enemyLabel,
}: ComparisonMetric & { enemyLabel: string }) {
  const margin = own - enemy;
  const outcome = margin > 0 ? "positive" : margin < 0 ? "negative" : "neutral";
  const formattedMargin = margin > 0 ? `+${margin.toLocaleString()}` : margin.toLocaleString();

  return (
    <article className="whd-strip__cell" data-metric={id}>
      <span className="whd-strip__heading">
        <HistoryMetricIcon id={id} />
        <span className="whd-strip__label">{label}</span>
      </span>
      <span className="whd-strip__values">
        <strong className="tabular-nums">{own.toLocaleString()}</strong>
        <Tooltip>
          <TooltipTrigger render={<span className="tabular-nums" tabIndex={0} />}>
            / {enemy.toLocaleString()}
          </TooltipTrigger>
          <TooltipContent>{enemyLabel}</TooltipContent>
        </Tooltip>
      </span>
      <span className={`whd-strip__margin whd-strip__margin--${outcome} tabular-nums`}>
        {formattedMargin}
      </span>
    </article>
  );
}

function HistoryMetricIcon({ id }: { id: string }) {
  const props = { className: "whd-strip__icon", size: 15, "aria-hidden": true } as const;

  if (id === "kills") return <SwordsIcon {...props} />;
  if (id === "towers") return <FlagIcon {...props} />;
  if (id === "base_hp") return <ShieldIcon {...props} />;
  if (id === "credits") return <GemIcon {...props} />;
  return <TargetArrowIcon {...props} />;
}

export function MvpRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="whd-mvp__row">
      <span className="whd-mvp__label">{label}</span>
      <span className="whd-mvp__value">{value}</span>
    </div>
  );
}
