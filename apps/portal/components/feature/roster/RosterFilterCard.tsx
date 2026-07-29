import { CLASS_NAMES } from "@guild/shared";
import {
  ActionIcon,
  Collapse,
  Group,
  MultiSelect,
  Paper,
  Select,
  Slider,
  Text,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { SearchIcon } from "@portal/components/icons";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { VolumeOutlined, VolumeMutedOutlined } from "../../../utils/icons";
import { isAudioPlaying, stopAudio } from "../../../utils/audio-player";
import type { RosterSortMode } from "../../../hooks/useRosterPageController";

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
  isMobile: boolean;
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
  isMobile,
}: Props) {
  const { t } = useTranslation("roster");
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);

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
        <Slider min={0} max={100} value={audioVolume} onChange={onAudioVolumeChange} aria-label={t("audio.aria.volumeSlider")} />
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{t("audio.hint")}</Text>
      </div>
    </Group>
  );

  const classData = CLASS_NAMES.map((className) => ({ value: className, label: className }));
  const sortData = [
    { value: "power", label: t("sort.powerDesc") },
    { value: "username", label: t("sort.usernameAsc") },
    { value: "class", label: t("sort.class") },
  ];

  return (
    <Paper withBorder className="roster-filter-card">
      <div className="roster-filter-padding">
        {isMobile ? (
          <>
            <Group gap="xs" wrap="nowrap" align="center">
              <TextInput
                className="roster-search-input"
                value={search}
                placeholder={t("search.placeholder.usernameOnly")}
                aria-label={t("search.aria.usernameOnly")}
                onChange={(event) => onSearchChange(event.currentTarget.value)}
                leftSection={<SearchIcon size={14} />}
                style={{ flex: 1 }}
              />
              <ActionIcon variant={filtersOpen ? "filled" : "default"} size="lg" onClick={toggleFilters} aria-label={t("filter.toggle")}>
                <IconAdjustmentsHorizontal size={18} />
              </ActionIcon>
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                {renderedCount}/{totalCount}
              </Text>
            </Group>
            <Collapse in={filtersOpen}>
              <Group wrap="wrap" gap={6} mt={6} className="roster-filter-controls">
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
                {audioControl}
              </Group>
            </Collapse>
          </>
        ) : (
          <Group wrap="wrap" gap="md" className="roster-filter-controls">
            <TextInput
              className="roster-search-input"
              value={search}
              placeholder={t("search.placeholder.usernameOnly")}
              aria-label={t("search.aria.usernameOnly")}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
              leftSection={<SearchIcon size={14} />}
            />
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
            {audioControl}
            <Text size="sm" c="dimmed" className="roster-count-text">
              {t("count.showing", { visible: renderedCount, total: totalCount })}
            </Text>
          </Group>
        )}
      </div>
    </Paper>
  );
}
