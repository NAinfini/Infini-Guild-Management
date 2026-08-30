import { InfoCircleIcon } from "@portal/components/icons";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import type { ReactNode } from "react";

type SiteConfigInfoProps = {
  title: string;
  description: string;
  icon: ReactNode;
};

function numberOr(value: string | number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function formatMb(bytes: number) {
  return Math.round(bytes / 1024 / 1024);
}

export function SiteConfigInfo({ title, description, icon }: SiteConfigInfoProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" className="site-config-info-trigger" aria-label={title} />}
      >
          <InfoCircleIcon size={15} />
      </TooltipTrigger>
      <TooltipContent className="site-config-info-card">
        <span className="site-config-info-card__icon" aria-hidden="true">{icon}</span>
        <span className="site-config-info-card__copy">
          <strong>{title}</strong>
          <span>{description}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function SiteConfigNumberField({
  id,
  label,
  value,
  min,
  max,
  suffix,
  onValueChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onValueChange: (value: number) => void;
}) {
  const suffixId = suffix ? `${id}-suffix` : undefined;

  return (
    <div className="site-config-number-field">
      <Label htmlFor={id}>{label}</Label>
      <div className="site-config-number-control">
        <Input
          id={id}
          className="site-config-number-input"
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          aria-describedby={suffixId}
          onChange={(event) => onValueChange(numberOr(event.currentTarget.valueAsNumber, value))}
        />
        {suffix ? <span id={suffixId} className="site-config-number-suffix">{suffix}</span> : null}
      </div>
    </div>
  );
}
