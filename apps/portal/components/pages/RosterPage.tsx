import { Suspense, lazy, useEffect, useState, type FocusEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Button, Paper, Skeleton, Stack } from "@mantine/core";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useRosterPageController } from "../../hooks/useRosterPageController";
import { resolveMediaUrl } from "../../utils/media";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import { RosterFilterCard } from "../feature/roster/RosterFilterCard";
import { RosterGrid } from "../feature/roster/RosterGrid";
import type { RosterEntry } from "../../hooks/useRosterPageController";
import "./RosterPage.css";

const LazyProfileModal = lazy(() =>
  import("../shared/ProfileModal").then((mod) => ({ default: mod.ProfileModal })),
);

/*
 * Restored per user request alongside the big-icon-card MemberCard geometry:
 * fewer, wider columns so the full-width square avatar has room to breathe.
 */
function resolveColumnCount(width: number): number {
  if (width >= 1600) return 8;
  if (width >= 1200) return 6;
  if (width >= 992) return 4;
  if (width >= 768) return 3;
  if (width >= 576) return 2;
  return 1;
}

export function RosterPage() {
  const { t } = useTranslation("roster");
  const navigate = useNavigate();
  const controller = useRosterPageController();

  const [windowWidth, setWindowWidth] = useState(() => typeof window === "undefined" ? 1920 : window.innerWidth);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLoadWarningToast(controller.usersQuery.isError, t("common:loadErrorRetry"));

  const { sortedRows, visibleCount, setVisibleCount, debouncedSearch, classFilter, sortMode } = controller;
  const shouldVirtualize = sortedRows.length > 50;
  const renderedRows = shouldVirtualize ? sortedRows : sortedRows.slice(0, visibleCount);
  const columnCount = resolveColumnCount(windowWidth);

  const handleCardFocus = (entry: RosterEntry) => {
    controller.playHoverAudio(entry);
  };

  const handleCardBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    controller.stopHoverAudio();
  };

  return (
    <PageLayout className="roster-page">
      <Stack gap="var(--page-rhythm)" className="roster-page__body">
      <RosterFilterCard
        search={controller.search}
        onSearchChange={controller.setSearch}
        classFilter={classFilter}
        onClassFilterChange={controller.setClassFilter}
        sortMode={sortMode}
        onSortModeChange={controller.setSortMode}
        audioMuted={controller.audioMuted}
        onAudioMutedChange={controller.setAudioMutedState}
        audioVolume={controller.audioVolume}
        onAudioVolumeChange={controller.setAudioVolumeState}
        renderedCount={renderedRows.length}
        totalCount={sortedRows.length}
      />

      {controller.usersQuery.isLoading ? (
        <Skeleton height={200} radius={8} />
      ) : sortedRows.length === 0 ? (
        <Paper className="roster-empty-card" withBorder p="lg">
          <EmptyState
            title={debouncedSearch || classFilter.length > 0 ? t("empty.filtered") : t("empty.default")}
            actions={
              <Button
                variant="default"
                onClick={() => { controller.setSearch(""); controller.setClassFilter([]); }}
                disabled={!debouncedSearch && classFilter.length === 0}
              >
                {t("action.resetFilters")}
              </Button>
            }
          />
        </Paper>
      ) : null}

      {sortedRows.length > 0 ? (
        <RosterGrid
          rows={renderedRows}
          shouldVirtualize={shouldVirtualize}
          columnCount={columnCount}
          staggerKey={`${debouncedSearch}|${classFilter.join(",")}|${sortMode}`}
          ariaLabel={t("grid.aria")}
          onCardClick={controller.openMemberProfile}
          onCardMouseEnter={controller.playHoverAudio}
          onCardMouseLeave={controller.stopHoverAudio}
          onCardFocus={handleCardFocus}
          onCardBlur={handleCardBlur}
        />
      ) : null}

      {!shouldVirtualize && sortedRows.length > renderedRows.length ? (
        <div className="roster-load-more">
          <Button variant="default" onClick={() => setVisibleCount((count) => count + 20)}>{t("action.loadMore")}</Button>
        </div>
      ) : null}
      </Stack>

      <Suspense fallback={null}>
        <LazyProfileModal
          open={controller.selected !== null}
          user={controller.selected?.user ?? null}
          profile={controller.selected?.profile ?? null}
          onClose={controller.closeMemberProfile}
          resolveMediaUrl={resolveMediaUrl}
          canEdit={Boolean(
            controller.selected && controller.sessionUser && (
              controller.canManagePermission(["admin.users.edit"]) ||
              controller.selected.user.id === controller.sessionUser.id
            ),
          )}
          editLabel={
            controller.selected && controller.sessionUser && controller.selected.user.id === controller.sessionUser.id
              ? t("common:profile.editMyProfile")
              : t("common:profile.editInAdmin")
          }
          onEdit={() => {
            if (!controller.selected || !controller.sessionUser) return;
            if (controller.selected.user.id === controller.sessionUser.id) {
              void navigate({ to: "/profile" });
            } else {
              void navigate({ to: "/admin", search: { member: controller.selected.user.username } });
            }
          }}
        />
      </Suspense>
    </PageLayout>
  );
}
