import type { MemberProfile, User } from "@guild/shared";
import { Badge, Modal, Popover, Stack, Text } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { MemberCard } from "./MemberCard";
import styles from "./MemberGrid2x5.module.css";

type MemberGridItem = {
  user: User;
  profile: MemberProfile;
};

type MemberGrid2x5Props = {
  members: MemberGridItem[];
  onSelect?: (member: MemberGridItem) => void;
};

export function MemberGrid2x5({ members, onSelect }: MemberGrid2x5Props) {
  const { t } = useTranslation("common");
  const isMobile = useMediaQuery("(max-width: 767px)") ?? false;
  const [overflowModalOpen, overflowModalHandlers] = useDisclosure(false);
  const overflowItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const visibleMembers = useMemo(() => members.slice(0, 10), [members]);
  const overflowMembers = useMemo(() => members.slice(10), [members]);
  const placeholders = useMemo(
    () => Array.from({ length: Math.max(0, 10 - visibleMembers.length) }, (_, index) => `placeholder-${index}`),
    [visibleMembers.length],
  );

  const memberClickHandlers = useMemo(() => {
    if (!onSelect) return {};
    const map: Record<string, () => void> = {};
    for (const entry of members) {
      map[entry.user.id] = () => onSelect(entry);
    }
    return map;
  }, [members, onSelect]);

  useEffect(() => {
    if (!overflowModalOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      overflowItemRefs.current[0]?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [overflowModalOpen]);

  const focusOverflowItem = (index: number) => {
    const count = overflowMembers.length;
    if (count === 0) {
      return;
    }
    const normalized = ((index % count) + count) % count;
    overflowItemRefs.current[normalized]?.focus();
  };

  const handleOverflowItemKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    entry: MemberGridItem,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOverflowItem(index + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOverflowItem(index - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusOverflowItem(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusOverflowItem(overflowMembers.length - 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      overflowModalHandlers.close();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(entry);
    }
  };

  const overflowContent = (
    <Stack gap={6} className={styles.overflowList}>
      {overflowMembers.length === 0 ? <Text c="dimmed">{t("members.noOverflow")}</Text> : null}
      {overflowMembers.map((entry, index) => (
        <button
          key={entry.user.id}
          type="button"
          className={styles.overflowItem}
          ref={(node) => {
            overflowItemRefs.current[index] = node;
          }}
          onClick={() => {
            onSelect?.(entry);
          }}
          onKeyDown={(event) => handleOverflowItemKeyDown(event, index, entry)}
          aria-label={`Select member ${entry.user.username}`}
        >
          <span>{entry.user.username}</span>
          <span>{entry.profile.classes[0] ?? "-"}</span>
          <span>{entry.profile.power}</span>
        </button>
      ))}
    </Stack>
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.grid2x5}>
        {visibleMembers.map((entry) => (
          <MemberCard
            key={entry.user.id}
            user={entry.user}
            profile={entry.profile}
            compact
            onClick={memberClickHandlers[entry.user.id]}
          />
        ))}
        {placeholders.map((placeholderKey) => (
          <div key={placeholderKey} className={styles.placeholder} aria-hidden="true">
            Empty
          </div>
        ))}
      </div>

      {overflowMembers.length > 0 ? (
        <>
          {isMobile ? (
            <button
              type="button"
              className={styles.overflowChip}
              onClick={overflowModalHandlers.open}
              aria-label={`Show ${overflowMembers.length} more members`}
            >
              +{overflowMembers.length}
            </button>
          ) : (
            <Popover width={300} position="bottom-end" withArrow shadow="md">
              <Popover.Target>
                <button
                  type="button"
                  className={styles.overflowChip}
                  aria-label={`Show ${overflowMembers.length} more members`}
                >
                  +{overflowMembers.length}
                </button>
              </Popover.Target>
              <Popover.Dropdown>{overflowContent}</Popover.Dropdown>
            </Popover>
          )}
        </>
      ) : null}

      <div className={styles.legend}>
        <Text c="dimmed" size="sm">
          Slots: {Math.min(10, members.length)} / 10
        </Text>
        {overflowMembers.length > 0 ? (
          <Badge color="blue" variant="light">
            {t("members.overflow", { count: overflowMembers.length })}
          </Badge>
        ) : null}
      </div>

      <Modal
        opened={overflowModalOpen}
        title={`More members (${overflowMembers.length})`}
        onClose={overflowModalHandlers.close}
      >
        {overflowContent}
      </Modal>
    </div>
  );
}

