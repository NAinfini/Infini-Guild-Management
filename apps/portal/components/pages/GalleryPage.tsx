import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@portal/components/ui/alert-dialog";
import { Button } from "@portal/components/ui/button";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useGalleryPageController } from "../../hooks/useGalleryPageController";
import { GalleryFiltersCard } from "../feature/gallery/GalleryFiltersCard";
import { GalleryAddMediaDialog } from "../feature/gallery/GalleryAddMediaDialog";
import { GalleryGrid } from "../feature/gallery/GalleryGrid";
import { GalleryLightboxModal } from "../feature/gallery/GalleryLightboxModal";
import { PageLayout } from "../layout/PageLayout";
import "./GalleryPage.css";

export function GalleryPage() {
  const { t } = useTranslation("gallery");
  const c = useGalleryPageController();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const lightboxTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !c.galleryQuery.hasNextPage || c.galleryQuery.isFetchingNextPage) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void c.galleryQuery.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [c.galleryQuery.fetchNextPage, c.galleryQuery.hasNextPage, c.galleryQuery.isFetchingNextPage]);

  const filters = (
    <GalleryFiltersCard
      typeFilter={c.typeFilter}
      onTypeFilterChange={c.setTypeFilter}
      sortOrder={c.sortOrder}
      onSortOrderChange={c.setSortOrder}
      dateFrom={c.dateFrom}
      dateTo={c.dateTo}
      search={c.search}
      onDateFromChange={c.setDateFrom}
      onDateToChange={c.setDateTo}
      onSearchChange={c.setSearch}
      onClearDates={() => {
        c.setDateFrom("");
        c.setDateTo("");
      }}
      canModerate={c.canModerate}
      canUpload={c.canUpload}
      selectedCount={c.selectedIds.length}
      onBulkDelete={() => c.bulkDeleteMutation.mutate(c.selectedIds)}
      bulkDeletePending={c.bulkDeleteMutation.isPending}
      onAddMedia={() => c.openAddMediaModal("image")}
      filterTypeLabel={t("filter.type")}
      bulkDeleteLabel={t("action.bulkDelete")}
      addMediaLabel={t("action.addMedia")}
    />
  );

  return (
    <PageLayout className="gallery-page" toolbar={filters}>
      <GalleryAddMediaDialog controller={c} />

      <AlertDialog
        open={c.deleteTargetId !== null}
        onOpenChange={(open) => { if (!open) c.cancelDeleteItem(); }}
      >
        <AlertDialogContent initialFocus={deleteCancelRef} data-intent="danger">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirm.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirm.delete.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              ref={deleteCancelRef}
              type="button"
              variant="outline"
              disabled={c.deleteMutation.isPending}
              onClick={c.cancelDeleteItem}
            >
              {t("common:action.cancel")}
            </Button>
            <AlertDialogAction
              type="button"
              className="bg-[var(--status-danger)] text-[var(--status-on-fill)] hover:bg-[var(--status-danger)] hover:opacity-90"
              loading={c.deleteMutation.isPending}
              onClick={() => { void c.confirmDeleteItem(); }}
            >
              {t("action.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="gallery-page__workspace">
        <GalleryGrid
          rows={c.rows}
          isLoading={c.galleryQuery.isLoading}
          isError={c.galleryQuery.isError}
          isExternalView={c.isExternalView}
          canModerate={c.canModerate}
          canLike={c.canLike}
          selectedIds={c.selectedIds}
          emptyTitle={c.emptyTitle}
          emptyDescription={c.emptyDescription}
          errorTitle={t("empty.error")}
          errorDescription={t("empty.errorDescription")}
          retryLabel={t("common:action.retry")}
          retryPending={c.galleryQuery.isFetching}
          hasActiveFilters={c.hasActiveFilters}
          canUpload={c.canUpload}
          resetFiltersLabel={t("action.resetFilters")}
          addMediaLabel={t("action.addMedia")}
          onRetry={() => { void c.galleryQuery.refetch(); }}
          onResetFilters={() => {
            c.setTypeFilter(undefined);
            c.setDateFrom("");
            c.setDateTo("");
            c.setSearch("");
          }}
          onAddMedia={() => c.openAddMediaModal("image")}
          onToggleSelect={c.toggleSelect}
          onDelete={c.handleDeleteItem}
          onToggleLike={c.toggleLike}
          onOpenLightbox={(id, trigger) => {
            lightboxTriggerRef.current = trigger;
            c.setLightboxId(id);
          }}
          resolveImageUrl={c.resolveImageUrl}
          formatDateTime={c.formatDateTime}
          actionDeleteLabel={t("action.delete")}
        />

        <div ref={loadMoreRef} className="gallery-load-more-sentinel" />
        {c.galleryQuery.hasNextPage ? (
          <div className="gallery-load-more">
            <Button
              variant="outline"
              onClick={() => { void c.galleryQuery.fetchNextPage(); }}
              loading={c.galleryQuery.isFetchingNextPage}
            >
              {t("loadMore")}
            </Button>
          </div>
        ) : null}
      </div>

      <GalleryLightboxModal
        open={Boolean(c.lightboxItem)}
        item={c.lightboxItem}
        index={c.lightboxIndex}
        total={c.rows.length}
        zoom={c.lightboxZoom}
        onClose={() => c.setLightboxId(null)}
        onPrev={c.openLightboxPrev}
        onNext={c.openLightboxNext}
        setZoom={c.setLightboxZoom}
        resolveImageUrl={c.resolveImageUrl}
        toEmbedVideoUrl={c.toEmbedVideoUrl}
        formatDateTime={c.formatDateTime}
        canLike={c.canLike}
        likePending={c.likePending}
        onToggleLike={c.toggleLike}
        canEdit={Boolean(c.lightboxItem && c.canEditGalleryItem(c.lightboxItem))}
        updatePending={c.updatePending}
        onUpdate={c.updateGalleryMetadata}
        returnFocusRef={lightboxTriggerRef}
      />
    </PageLayout>
  );
}
