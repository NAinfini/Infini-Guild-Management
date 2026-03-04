type AvailabilityHeatStripProps = {
  counts: number[];
  maxCount: number;
};

export function AvailabilityHeatStrip({ counts, maxCount }: AvailabilityHeatStripProps) {
  const normalized = Array.from({ length: 24 }).map((_, hour) => counts[hour] ?? 0);
  if (maxCount <= 0) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(24, minmax(0, 1fr))",
          gap: 2,
        }}
        aria-label="Availability heat map"
      >
        {normalized.map((_, hour) => (
          <div
            key={`availability-hour-${hour}`}
            style={{
              height: 8,
              borderRadius: 2,
              background: "color-mix(in srgb, var(--ant-color-fill-secondary) 42%, transparent)",
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(24, minmax(0, 1fr))",
        gap: 2,
      }}
      aria-label="Availability heat map"
    >
      {normalized.map((count, hour) => {
        const ratio = count > 0 ? Math.min(1, count / maxCount) : 0;
        const strength = Math.round(12 + ratio * 78);
        return (
          <div
            key={`availability-hour-${hour}`}
            title={`${String(hour).padStart(2, "0")}:00 · ${count} available`}
            style={{
              height: 8,
              borderRadius: 2,
              background:
                count > 0
                  ? `color-mix(in srgb, var(--ant-color-success) ${strength}%, transparent)`
                  : "color-mix(in srgb, var(--ant-color-fill-secondary) 42%, transparent)",
            }}
          />
        );
      })}
    </div>
  );
}
