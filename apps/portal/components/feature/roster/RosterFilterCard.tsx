import { SearchIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Checkbox } from "@portal/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@portal/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@portal/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { ContentFilterGroup, ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { VolumeOutlined, VolumeMutedOutlined } from "../../../utils/icons";
import { isAudioPlaying, stopAudio } from "../../../utils/audio-player";
import type { RosterSortMode } from "../../../hooks/useRosterPageController";
import { useClassCatalog } from "../../../hooks/data/useClassData";
import { buildClassOptions } from "../../../utils/class-catalog";

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  classFilter: string[];
  onClassFilterChange: (value: string[]) => void;
  sortMode: RosterSortMode;
  onSortModeChange: (value: RosterSortMode) => void;
  audioMuted: boolean;
  onAudioMutedChange: (value: boolean) => void;
  audioVolume: number;
  onAudioVolumeChange: (value: number) => void;
  renderedCount: number;
  totalCount: number;
};

const SORT_MODES = ["power", "display_name", "class"] as const;

export function RosterFilterCard({
  search,
  onSearchChange,
  classFilter,
  onClassFilterChange,
  sortMode,
  onSortModeChange,
  audioMuted,
  onAudioMutedChange,
  audioVolume,
  onAudioVolumeChange,
  renderedCount,
  totalCount,
}: Props) {
  const { t } = useTranslation("roster");
  const classCatalog = useClassCatalog();
  const [audioOpen, setAudioOpen] = useState(false);
  const volumeId = useId();

  const setClassChecked = (className: string, checked: boolean) => {
    if (checked) {
      if (!classFilter.includes(className)) {
        onClassFilterChange([...classFilter, className]);
      }
      return;
    }
    onClassFilterChange(classFilter.filter((value) => value !== className));
  };

  const audioControl = (
    <div className="roster-audio-settings">
      <div className="roster-audio-setting-row">
        <Button
          aria-pressed={audioMuted}
          variant={audioMuted ? "destructive" : "outline"}
          size="icon"
          onClick={() => {
            const nextMuted = !audioMuted;
            if (nextMuted && isAudioPlaying()) {
              stopAudio();
            }
            onAudioMutedChange(nextMuted);
          }}
          aria-label={audioMuted ? t("audio.aria.unmute") : t("audio.aria.mute")}
        >
          {audioMuted ? <VolumeMutedOutlined size={18} /> : <VolumeOutlined size={18} />}
        </Button>
        <span className="roster-audio-setting-copy">
          {audioMuted ? t("audio.aria.unmute") : t("audio.aria.mute")}
        </span>
      </div>
      <div className="roster-volume-control">
        <div className="roster-volume-heading">
          <label htmlFor={volumeId} className="roster-volume-label">{t("audio.volume")}</label>
          <output className="roster-volume-value" htmlFor={volumeId}>{audioVolume}%</output>
        </div>
        <input
          id={volumeId}
          className="roster-volume-range"
          type="range"
          min={0}
          max={100}
          step={1}
          value={audioVolume}
          onChange={(event) => onAudioVolumeChange(event.currentTarget.valueAsNumber)}
          aria-label={t("audio.aria.volumeSlider")}
          aria-valuetext={`${audioVolume}%`}
        />
      </div>
    </div>
  );
  const audioPreferences = (
    <Popover open={audioOpen} onOpenChange={setAudioOpen}>
      <PopoverTrigger
        render={(
          <Button
            variant="outline"
            size="icon-lg"
            className="roster-audio-trigger"
            aria-label={t("audio.hint")}
          />
        )}
      >
        {audioMuted ? <VolumeMutedOutlined size={18} /> : <VolumeOutlined size={18} />}
      </PopoverTrigger>
      <PopoverContent className="roster-audio-menu__panel" align="end" side="bottom" sideOffset={8}>
        <PopoverHeader className="roster-audio-menu__heading">
          <PopoverTitle>{t("audio.hint")}</PopoverTitle>
        </PopoverHeader>
        {audioControl}
      </PopoverContent>
    </Popover>
  );

  const classData = buildClassOptions(classCatalog);
  const sortData = [
    { value: "power", label: t("sort.powerDesc") },
    { value: "display_name", label: t("sort.displayNameAsc") },
    { value: "class", label: t("sort.class") },
  ];
  const activeFilterCount = [
    classFilter.length > 0,
    sortMode !== "power",
  ].filter(Boolean).length;
  return (
    <ContentFilterToolbar
      className="roster-filter-card"
      search={(
        <InputGroup className="roster-search-input">
          <InputGroupAddon>
            <SearchIcon size={15} aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            placeholder={t("search.placeholder.displayNameOnly")}
            aria-label={t("search.aria.displayNameOnly")}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
        </InputGroup>
      )}
      filterControls={(
        <div className="roster-filter-controls">
          <ContentFilterGroup label={t("filter.class.aria")}>
            <div className="roster-filter-options" role="group" aria-label={t("filter.class.aria")}>
              {classData.map((item) => (
                <div
                  key={item.value}
                  className="roster-filter-option"
                  onClick={(event) => {
                    if ((event.target as Element).closest('[data-slot="checkbox"]')) return;
                    setClassChecked(item.value, !classFilter.includes(item.value));
                  }}
                >
                  <Checkbox
                    checked={classFilter.includes(item.value)}
                    onCheckedChange={(checked) => setClassChecked(item.value, checked)}
                    aria-label={item.label}
                  />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </ContentFilterGroup>
          <ContentFilterGroup label={t("sort.aria")}>
            <RadioGroup
              value={sortMode}
              aria-label={t("sort.aria")}
              onValueChange={(value) => {
                if ((SORT_MODES as readonly string[]).includes(value)) onSortModeChange(value as RosterSortMode);
              }}
            >
              {sortData.map((item) => (
                <div
                  key={item.value}
                  className="roster-filter-option"
                  onClick={(event) => {
                    if ((event.target as Element).closest('[data-slot="radio-group-item"]')) return;
                    onSortModeChange(item.value as RosterSortMode);
                  }}
                >
                  <RadioGroupItem value={item.value} aria-label={item.label} />
                  <span>{item.label}</span>
                </div>
              ))}
            </RadioGroup>
          </ContentFilterGroup>
        </div>
      )}
      actions={audioPreferences}
      summary={(
        <span className="roster-count-text">
          {t("count.showing", { visible: renderedCount, total: totalCount })}
        </span>
      )}
      filterLabel={t("common:filter.toggle")}
      activeFilterCount={activeFilterCount}
      resetLabel={t("common:filter.reset")}
      onReset={() => {
        onClassFilterChange([]);
        onSortModeChange("power");
      }}
    />
  );
}
