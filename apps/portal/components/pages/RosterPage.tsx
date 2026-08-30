import { Suspense, lazy, type FocusEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { UsersIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Card, CardContent } from "@portal/components/ui/card";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useRosterPageController } from "../../hooks/useRosterPageController";
import { resolveMediaUrl } from "../../utils/media";
import { buildVisiblePages } from "../../utils/pagination";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import { RosterFilterCard } from "../feature/roster/RosterFilterCard";
import { RosterGrid } from "../feature/roster/RosterGrid";
import type { RosterEntry } from "../../hooks/useRosterPageController";
import "./RosterPage.css";

const LazyProfileModal = lazy(() =>
  import("../shared/ProfileModal").then((mod) => ({ default: mod.ProfileModal })),
);

export function RosterPage() {
  const { t } = useTranslation("roster");
  const navigate = useNavigate();
  const controller = useRosterPageController();

  useLoadWarningToast(controller.usersQuery.isError, t("common:loadErrorRetry"));

  const { sortedRows, pageRows, currentPage, pageCount, debouncedSearch, classFilter, sortMode } = controller;
  const rosterUnavailable = controller.usersQuery.isError && sortedRows.length === 0;

  const handleCardFocus = (entry: RosterEntry) => {
    controller.playHoverAudio(entry);
  };

  const handleCardBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    controller.stopHoverAudio();
  };

  return (
    <>
      <PageLayout
        className="roster-page"
        workspaceMode="contained"
        toolbar={(
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
            renderedCount={pageRows.length}
            totalCount={sortedRows.length}
          />
        )}
      >
        <div className="roster-page__body">
          {rosterUnavailable ? (
            <Card className="roster-empty-card">
              <CardContent className="roster-empty-card__content">
                <EmptyState
                  status="error"
                  title={t("common:loadError")}
                  description={t("error.loadDescription")}
                  actions={(
                    <Button onClick={() => { void controller.usersQuery.refetch(); }}>
                      {t("common:action.retry")}
                    </Button>
                  )}
                />
              </CardContent>
            </Card>
          ) : controller.usersQuery.isLoading ? (
            <div className="roster-loading-grid" aria-busy="true">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="roster-loading-card" />
              ))}
            </div>
          ) : sortedRows.length === 0 ? (
            <Card className="roster-empty-card">
              <CardContent className="roster-empty-card__content">
                <EmptyState
                  title={debouncedSearch || classFilter.length > 0 ? t("empty.filtered") : t("empty.default")}
                  description={debouncedSearch || classFilter.length > 0 ? t("empty.filteredDescription") : t("empty.description")}
                  icon={<UsersIcon size={28} aria-hidden="true" />}
                  actions={(
                    <Button
                      variant="outline"
                      onClick={() => {
                        controller.setSearch("");
                        controller.setClassFilter([]);
                      }}
                      disabled={!debouncedSearch && classFilter.length === 0}
                    >
                      {t("action.resetFilters")}
                    </Button>
                  )}
                />
              </CardContent>
            </Card>
          ) : null}

          {sortedRows.length > 0 ? (
            <RosterGrid
              key={currentPage}
              rows={pageRows}
              ariaLabel={t("grid.aria")}
              onCardClick={controller.openMemberProfile}
              onCardMouseEnter={controller.playHoverAudio}
              onCardMouseLeave={controller.stopHoverAudio}
              onCardFocus={handleCardFocus}
              onCardBlur={handleCardBlur}
            />
          ) : null}

          {pageCount > 1 ? (
            <nav className="roster-pagination" aria-label={t("common:pagination.page")}>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("common:pagination.prev")}
                disabled={currentPage === 1}
                onClick={() => controller.setPage(currentPage - 1)}
              >
                <IconChevronLeft aria-hidden />
              </Button>
              {buildVisiblePages(currentPage, pageCount).map((page, index) => page === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className="roster-pagination__ellipsis" aria-hidden>…</span>
              ) : (
                <Button
                  key={page}
                  type="button"
                  size="icon-sm"
                  variant={page === currentPage ? "secondary" : "ghost"}
                  aria-label={t("common:pagination.goToPage", { page })}
                  aria-current={page === currentPage ? "page" : undefined}
                  onClick={() => controller.setPage(page)}
                >
                  {page}
                </Button>
              ))}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("common:pagination.next")}
                disabled={currentPage === pageCount}
                onClick={() => controller.setPage(currentPage + 1)}
              >
                <IconChevronRight aria-hidden />
              </Button>
            </nav>
          ) : null}
        </div>
      </PageLayout>
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
              void navigate({ to: "/admin", search: { member: controller.selected.user.display_name } });
            }
          }}
        />
      </Suspense>
    </>
  );
}
