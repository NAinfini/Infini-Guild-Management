import {
  ActionIcon,
  Group,
  MultiSelect,
  Paper,
  Select,
  Slider,
  Text,
  TextInput,
} from "@mantine/core";
import { useClickOutside, useDisclosure } from "@mantine/hooks";
import { SearchIcon } from "@portal/components/icons";
import { ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { useTranslation } from "react-i18next";
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

const SORT_MODES = ["power", "username", "class"] as const;

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
  const [audioOpen, { close: closeAudio, toggle: toggleAudio }] = useDisclosure(false);
  const audioPreferencesRef = useClickOutside(closeAudio);

  const audioControl = (
    <Group gap={8} align="center" wrap="nowrap" className="roster-audio-popover">
      <ActionIcon
        aria-pressed={audioMuted}
        variant={audioMuted ? "light" : "default"}
        color={audioMuted ? "red" : "gray"}
        onClick={() => {
          const nextPressed = !audioMuted;
          if (nextPressed && isAudioPlaying()) {
            stopAudio();
          }
          onAudioMutedChange(nextPressed);
        }}
        size="sm"
        aria-label={audioMuted ? t("audio.aria.unmute") : t("audio.aria.mute")}
      >
        {audioMuted ? <VolumeMutedOutlined size={18} /> : <VolumeOutlined size={18} />}
      </ActionIcon>
      <div className="roster-volume-control">
        <Text size="xs" c="dimmed" className="roster-volume-label">{t("audio.volume")}</Text>
        <Slider
          min={0}
          max={100}
          value={audioVolume}
          onChange={onAudioVolumeChange}
          thumbLabel={t("audio.aria.volumeSlider")}
        />
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{t("audio.hint")}</Text>
      </div>
    </Group>
  );
  const audioPreferences = (
    <div className="roster-audio-menu" ref={audioPreferencesRef}>
      <ActionIcon
        variant="default"
        size="lg"
        className="roster-audio-trigger"
        aria-label={t("audio.hint")}
        aria-expanded={audioOpen}
        aria-controls="roster-audio-preferences"
        onClick={toggleAudio}
      >
        {audioMuted ? <VolumeMutedOutlined size={18} /> : <VolumeOutlined size={18} />}
      </ActionIcon>
      {audioOpen ? (
        <Paper
          id="roster-audio-preferences"
          role="dialog"
          aria-label={t("audio.hint")}
          withBorder
          className="roster-audio-menu__panel"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeAudio();
          }}
        >
          {audioControl}
        </Paper>
      ) : null}
    </div>
  );

  const classData = buildClassOptions(classCatalog);
  const sortData = [
    { value: "power", label: t("sort.powerDesc") },
    { value: "username", label: t("sort.usernameAsc") },
    { value: "class", label: t("sort.class") },
  ];
  const activeFilterCount = [
    search.trim().length > 0,
    classFilter.length > 0,
    sortMode !== "power",
  ].filter(Boolean).length;
  return (
    <ContentFilterToolbar
      className="roster-filter-card"
      search={(
        <TextInput
          className="roster-search-input"
          value={search}
          placeholder={t("search.placeholder.usernameOnly")}
          aria-label={t("search.aria.usernameOnly")}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          leftSection={<SearchIcon size={14} />}
        />
      )}
      controls={(
        <Group wrap="wrap" gap="sm" className="roster-filter-controls">
            <MultiSelect
              className="roster-class-select"
              value={classFilter}
              onChange={onClassFilterChange}
              data={classData}
              placeholder={t("filter.class.placeholder")}
              aria-label={t("filter.class.aria")}
              clearable
              searchable
            />
            <Select
              className="roster-sort-select"
              value={sortMode}
              aria-label={t("sort.aria")}
              onChange={(value) => { if (value && (SORT_MODES as readonly string[]).includes(value)) onSortModeChange(value as RosterSortMode); }}
              data={sortData}
            />
        </Group>
      )}
      primary={(
        <>
          {audioPreferences}
          <Text size="sm" c="dimmed" className="roster-count-text">
            {t("count.showing", { visible: renderedCount, total: totalCount })}
          </Text>
        </>
      )}
      toggleLabel={t("common:filter.toggle")}
      activeFilterCount={activeFilterCount}
      collapseBelow={920}
    />
  );
}
