import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { ChevronLeftIcon, ChevronRightIcon, FlagIcon, PlusIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";

type GuildWarActiveTopCardProps = {
  selectedEventId: string | undefined;
  eventOptions: Array<{ value: string; label: string }>;
  eventPlaceholder: string;
  onSelectedEventIdChange: (value: string) => void;
  canManage: boolean;
  activeSearch: string;
  onActiveSearchChange: (value: string) => void;
  searchPlaceholder: string;
  matchLabel?: string;
  onPrevMatch?: () => void;
  onNextMatch?: () => void;
  hasMatches?: boolean;
  onConcludeWar?: () => void;
  concludeWarLabel?: string;
  concludeWarDisabled?: boolean;
  concludeWarDisabledReason?: string;
  onAddTeam?: () => void;
  saveTeamsPending?: boolean;
};

export function GuildWarActiveTopCard({
  selectedEventId,
  eventOptions,
  eventPlaceholder,
  onSelectedEventIdChange,
  canManage,
  activeSearch,
  onActiveSearchChange,
  searchPlaceholder,
  matchLabel,
  onPrevMatch,
  onNextMatch,
  hasMatches,
  onConcludeWar,
  concludeWarLabel,
  concludeWarDisabled,
  concludeWarDisabledReason,
  onAddTeam,
  saveTeamsPending,
}: GuildWarActiveTopCardProps) {
  const { t } = useTranslation("guild-war");
  return (
    <Card className="guild-war-active-top-card">
      <div className="guild-war-active-top-card__filters">
        <div className="guild-war-active-top-card__event-slot">
          <Label className="text-xs text-muted-foreground">
            {t("active.event")}
          </Label>
          <Select
            value={selectedEventId ?? null}
            items={eventOptions}
            onValueChange={(value) => onSelectedEventIdChange(value ?? "")}
            disabled={saveTeamsPending}
          >
            <SelectTrigger className="guild-war-active-top-card__event" aria-label={t("active.aria.selectEvent")}>
              <SelectValue placeholder={eventPlaceholder} />
            </SelectTrigger>
            <SelectContent align="start">
              {eventOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="guild-war-active-top-card__search-slot">
          <Input
            className="guild-war-active-top-card__search"
            value={activeSearch}
            onChange={(event) => onActiveSearchChange(event.currentTarget.value)}
            placeholder={searchPlaceholder}
            aria-label={t("active.aria.searchMembers")}
          />
          {activeSearch && hasMatches ? (
            <div className="guild-war-active-top-card__matches">
              <Button type="button" variant="ghost" size="icon-sm" onClick={onPrevMatch} disabled={!onPrevMatch} aria-label={t("active.aria.prevMatch")}>
                <ChevronLeftIcon size={14} />
              </Button>
              <span className="guild-war-active-top-card__match-label">{matchLabel}</span>
              <Button type="button" variant="ghost" size="icon-sm" onClick={onNextMatch} disabled={!onNextMatch} aria-label={t("active.aria.nextMatch")}>
                <ChevronRightIcon size={14} />
              </Button>
            </div>
          ) : null}
        </div>

        {canManage ? (
          <div className="guild-war-active-top-card__actions">
            {onAddTeam ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onAddTeam}
              >
                <PlusIcon size={16} data-icon="inline-start" />
                {t("active.addTeam")}
              </Button>
            ) : null}
            {onConcludeWar ? (
              <div className="guild-war-active-top-card__danger">
                <Tooltip>
                  <TooltipTrigger render={<span />}>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={onConcludeWar}
                      disabled={concludeWarDisabled}
                    >
                      <FlagIcon size={16} data-icon="inline-start" />
                      {concludeWarLabel ?? t("active.concludeWar")}
                    </Button>
                  </TooltipTrigger>
                  {concludeWarDisabled && concludeWarDisabledReason ? (
                    <TooltipContent>{concludeWarDisabledReason}</TooltipContent>
                  ) : null}
                </Tooltip>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
