import { hasRoleAtLeast } from "@guild/shared";
import { arrayMove } from "@dnd-kit/sortable";
import { Button, Drawer, Group, Stack, Text, TextInput, Tooltip, VisuallyHidden } from "@mantine/core";
import { DepthButton, DepthToggle, InfiniCard } from "@infini-dev-kit/frontend/components";
import { modals } from "@mantine/modals";
import { IconArchive, IconEdit, IconPinned } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createWikiArticle,
  createWikiCategory,
  deleteWikiCategory,
  uploadWikiArticleImages,
  updateWikiArticle,
  updateWikiCategory,
} from "../../api/mutations/wiki";
import {
  fetchWikiArticleBySlug,
  fetchWikiArticles,
  fetchWikiCategories,
} from "../../api/queries/wiki";
import { queryKeys } from "../../api/query-keys";
import { useAppError } from "../../hooks/useAppError";
import { useBeforeUnloadPrompt } from "../../hooks/useBeforeUnloadPrompt";
import { useExternalView } from "../../hooks/useExternalView";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useAuthStore } from "../../stores/auth";
import { WikiArticleEditorCard } from "../feature/wiki/WikiArticleEditorCard";
import { WikiArticleListCard } from "../feature/wiki/WikiArticleListCard";
import { WikiCategoryEditorCard, type WikiCategoryDraft } from "../feature/wiki/WikiCategoryEditorCard";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import { TipTapEditor, TIPTAP_DEFAULT_JSON } from "../shared/TipTapEditor";
import "./WikiPage.css";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return format(date, "yyyy-MM-dd HH:mm");
}

export function WikiPage() {
  const { t } = useTranslation("wiki");
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const routeSlug = (params as { slug?: string }).slug ?? null;
  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const isMobile = !isDesktop;
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isExternalView = useExternalView();
  const isModerator = Boolean(user && hasRoleAtLeast(user.role, "moderator"));
  const canEdit = isModerator && !isExternalView;
  const { showError } = useAppError();

  const [search, setSearch] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(routeSlug);

  const [categoryName, setCategoryName] = useState("");
  const [categoryDrafts, setCategoryDrafts] = useState<WikiCategoryDraft[]>([]);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

  const [articleTitle, setArticleTitle] = useState("");
  const [articleBody, setArticleBody] = useState(TIPTAP_DEFAULT_JSON);
  const [articleSortOrder, setArticleSortOrder] = useState(0);
  const [articleCategoryId, setArticleCategoryId] = useState<string>("");
  const [pinnedIntent, setPinnedIntent] = useState<"none" | "pin" | "unpin">("none");
  const [archiveIntent, setArchiveIntent] = useState<"none" | "archive" | "unarchive">("none");
  const [isCreatingArticle, setIsCreatingArticle] = useState(false);
  const [editorTab, setEditorTab] = useState<"article" | "categories">("article");
  const [mobilePane, setMobilePane] = useState<"list" | "article">("list");
  const [showEditorPane, setShowEditorPane] = useState(false);
  const isEditorPaneVisible = canEdit && showEditorPane;

  const categoriesQuery = useQuery({
    queryKey: queryKeys.wiki.categories(),
    queryFn: fetchWikiCategories,
  });

  const selectedCategoryFilterKey =
    selectedCategoryIds.length === 0 ? "all" : [...selectedCategoryIds].sort().join(",");
  const singleSelectedCategoryId = selectedCategoryIds.length === 1 ? selectedCategoryIds[0] : undefined;

  const articlesQuery = useQuery({
    queryKey: queryKeys.wiki.articles(selectedCategoryFilterKey, search, archivedOnly ? "archived" : "active"),
    queryFn: () =>
      fetchWikiArticles({
        page: 1,
        limit: 100,
        category_id: singleSelectedCategoryId,
        search: search.trim() || undefined,
        archived: archivedOnly,
      }),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.wiki.article(selectedSlug),
    enabled: Boolean(selectedSlug),
    queryFn: () => fetchWikiArticleBySlug(selectedSlug as string),
  });

  const createCategoryMutation = useMutation({
    mutationFn: createWikiCategory,
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.categoryCreated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
      setCategoryName("");
    },
    onError: (error) => {
      showError(error, t("message.categoryCreateFailed"));
    },
  });

  const saveCategoryDraftsMutation = useMutation({
    mutationFn: async (drafts: WikiCategoryDraft[]) => {
      const currentById = new Map(categories.map((category) => [category.id, category]));
      const patches = drafts
        .map((draft) => {
          const current = currentById.get(draft.id);
          if (!current) {
            return null;
          }

          const payload: Record<string, unknown> = {};
          const nextName = draft.name.trim();
          if (nextName && nextName !== current.name) {
            payload.name = nextName;
          }
          const nextParent = draft.parent_id || null;
          if (nextParent !== current.parent_id) {
            payload.parent_id = nextParent;
          }
          if (draft.sort_order !== current.sort_order) {
            payload.sort_order = draft.sort_order;
          }
          return Object.keys(payload).length > 0 ? { id: draft.id, payload } : null;
        })
        .filter((item): item is { id: string; payload: Record<string, unknown> } => item !== null);

      for (const patch of patches) {
        await updateWikiCategory(patch.id, patch.payload);
      }
      return patches.length;
    },
    onSuccess: async (changedCount) => {
      if (changedCount > 0) {
        notifications.show({ color: "infini-success", message: t("message.categorySaved") });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
    onError: (error) => {
      showError(error, t("message.categorySaveFailed"));
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: deleteWikiCategory,
    onMutate: (categoryId) => {
      setDeletingCategoryId(categoryId);
    },
    onSuccess: async () => {
      notifications.show({ color: "infini-success", message: t("message.categoryDeleted") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
    onError: (error) => {
      showError(error, t("message.categoryDeleteFailed"));
    },
    onSettled: () => {
      setDeletingCategoryId(null);
    },
  });

  const createArticleMutation = useMutation({
    mutationFn: createWikiArticle,
    onSuccess: async (created) => {
      notifications.show({ color: "infini-success", message: t("message.articleCreated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      setIsCreatingArticle(false);
      setSelectedSlug(created.slug);
    },
    onError: (error) => {
      showError(error, t("message.articleCreateFailed"));
    },
  });

  const updateArticleMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      updateWikiArticle(id, payload),
    onSuccess: async () => {
      setPinnedIntent("none");
      notifications.show({ color: "infini-success", message: t("message.articleSaved") });
      setArchiveIntent("none");
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      if (selectedSlug) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.article(selectedSlug) });
      }
    },
    onError: (error) => {
      showError(error, t("message.articleSaveFailed"));
    },
  });

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const categoriesById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const articles = useMemo(() => {
    const rows = articlesQuery.data?.data ?? [];
    const selectedSet = new Set(selectedCategoryIds);
    return rows.filter((item) => {
      if (selectedCategoryIds.length > 0 && !selectedSet.has(item.category_id)) {
        return false;
      }
      if (pinnedOnly && !item.pinned) {
        return false;
      }
      return true;
    });
  }, [articlesQuery.data?.data, pinnedOnly, selectedCategoryIds]);
  const selectedArticle = detailQuery.data ?? null;

  useEffect(() => {
    if (routeSlug && routeSlug !== selectedSlug) {
      setSelectedSlug(routeSlug);
    }
  }, [routeSlug, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug && !isCreatingArticle && articles.length > 0) {
      const firstSlug = articles[0]?.slug ?? null;
      setSelectedSlug(firstSlug);
      if (firstSlug) {
        void navigate({
          to: "/wiki/$slug",
          params: { slug: firstSlug },
          viewTransition: false,
        });
      }
    }
  }, [articles, isCreatingArticle, navigate, selectedSlug]);

  useEffect(() => {
    if (!isMobile) {
      setMobilePane("list");
    }
  }, [isMobile]);

  useEffect(() => {
    const categoryIdSet = new Set(categories.map((item) => item.id));
    setSelectedCategoryIds((current) => {
      const next = current.filter((id) => categoryIdSet.has(id));
      return next.length === current.length ? current : next;
    });
  }, [categories]);

  useEffect(() => {
    if (!canEdit) {
      setShowEditorPane(false);
      setIsCreatingArticle(false);
    }
  }, [canEdit]);

  useEffect(() => {
    if (!selectedArticle) return;
    setIsCreatingArticle(false);
    setPinnedIntent("none");
    setArchiveIntent("none");
    setArticleTitle(selectedArticle.title);
    setArticleBody(selectedArticle.body_json);
    setArticleSortOrder(selectedArticle.sort_order);
    setArticleCategoryId(selectedArticle.category_id);
  }, [selectedArticle]);

  useEffect(() => {
    const nextDrafts = [...categories]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        parent_id: category.parent_id ?? "",
        sort_order: category.sort_order,
      }));
    setCategoryDrafts(nextDrafts);
  }, [categories]);

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const selectedCategory = selectedArticle ? categoriesById.get(selectedArticle.category_id) ?? null : null;
  const hasCategoryDraftChanges = useMemo(() => {
    if (categoryDrafts.length !== categories.length) {
      return true;
    }

    for (const draft of categoryDrafts) {
      const current = categoriesById.get(draft.id);
      if (!current) {
        return true;
      }
      if (draft.name.trim() !== current.name) {
        return true;
      }
      if ((draft.parent_id || null) !== current.parent_id) {
        return true;
      }
      if (draft.sort_order !== current.sort_order) {
        return true;
      }
    }

    return false;
  }, [categories.length, categoriesById, categoryDrafts]);

  const isDirty = useMemo(() => {
    if (!canEdit) return false;

    const articleDirty = selectedArticle
      ? articleTitle !== selectedArticle.title ||
        articleBody !== selectedArticle.body_json ||
        articleSortOrder !== selectedArticle.sort_order ||
        articleCategoryId !== selectedArticle.category_id ||
        pinnedIntent !== "none" ||
        archiveIntent !== "none"
      : articleTitle.trim().length > 0 ||
        articleBody !== TIPTAP_DEFAULT_JSON ||
        articleSortOrder !== 0 ||
        articleCategoryId.trim().length > 0;

    return categoryName.trim().length > 0 || hasCategoryDraftChanges || articleDirty;
  }, [
    articleBody,
    articleCategoryId,
    articleSortOrder,
    articleTitle,
    pinnedIntent,
    archiveIntent,
    categoryName,
    hasCategoryDraftChanges,
    canEdit,
    selectedArticle,
  ]);
  useBeforeUnloadPrompt(isDirty);

  const handleSelectArticle = (slug: string) => {
    setIsCreatingArticle(false);
    setSelectedSlug(slug);
    void navigate({
      to: "/wiki/$slug",
      params: { slug },
      viewTransition: false,
    });
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleStartCreateArticle = () => {
    setEditorTab("article");
    setShowEditorPane(true);
    setIsCreatingArticle(true);
    setPinnedIntent("none");
    setArchiveIntent("none");
    setSelectedSlug(null);
    setArticleTitle("");
    setArticleBody(TIPTAP_DEFAULT_JSON);
    setArticleSortOrder(0);
    setArticleCategoryId(selectedCategoryId ?? selectedCategoryIds[0] ?? categories[0]?.id ?? "");
    if (routeSlug) {
      void navigate({ to: "/wiki", viewTransition: false });
    }
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleOpenArticleEditor = () => {
    setEditorTab("article");
    setShowEditorPane(true);
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleOpenCategoryEditor = () => {
    setEditorTab("categories");
    setShowEditorPane(true);
    setIsCreatingArticle(false);
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleExitArticleEditor = () => {
    if (selectedArticle) {
      setArticleTitle(selectedArticle.title);
      setArticleBody(selectedArticle.body_json);
      setArticleSortOrder(selectedArticle.sort_order);
      setArticleCategoryId(selectedArticle.category_id);
    } else {
      setArticleTitle("");
      setArticleBody(TIPTAP_DEFAULT_JSON);
      setArticleSortOrder(0);
      setArticleCategoryId("");
    }
    setShowEditorPane(false);
    setIsCreatingArticle(false);
    setPinnedIntent("none");
    setArchiveIntent("none");
  };

  const handleCategoryFilterChange = (values: string[]) => {
    setSelectedCategoryIds(values);
    setSelectedCategoryId(values.length === 1 ? values[0] : undefined);
  };

  const handleCreateCategory = () =>
    createCategoryMutation.mutate({
      name: categoryName.trim() || t("categoryEditor.defaultName"),
    });

  const handleCategoryDraftNameChange = (categoryId: string, value: string) => {
    setCategoryDrafts((current) =>
      current.map((category) =>
        category.id === categoryId ? { ...category, name: value } : category,
      ),
    );
  };

  const handleCategoryDraftParentIdChange = (categoryId: string, value: string) => {
    setCategoryDrafts((current) =>
      current.map((category) =>
        category.id === categoryId ? { ...category, parent_id: value } : category,
      ),
    );
  };

  const handleCategoryReorder = (activeId: string, overId: string) => {
    setCategoryDrafts((current) => {
      const oldIndex = current.findIndex((category) => category.id === activeId);
      const newIndex = current.findIndex((category) => category.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        return current;
      }
      return arrayMove(current, oldIndex, newIndex).map((category, index) => ({
        ...category,
        sort_order: index,
      }));
    });
  };

  const handleSaveCategoryDrafts = () => {
    void saveCategoryDraftsMutation.mutateAsync(categoryDrafts);
  };

  const handleCloseCategoryEditorWithoutSave = () => {
    const resetDrafts = [...categories]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        parent_id: category.parent_id ?? "",
        sort_order: category.sort_order,
      }));
    setCategoryDrafts(resetDrafts);
    setShowEditorPane(false);
    setIsCreatingArticle(false);
  };

  const handleDeleteCategory = (categoryId: string) => {
    const category = categoriesById.get(categoryId);
    if (!category) return;
    modals.openConfirmModal({
      title: t("confirm.deleteCategory.title"),
      children: t("confirm.deleteCategory.description", { name: category.name }),
      centered: true,
      confirmProps: { color: "infini-danger" },
      labels: {
        cancel: t("common:action.cancel"),
        confirm: t("common:action.delete"),
      },
      onConfirm: () => deleteCategoryMutation.mutate(categoryId),
    });
  };

  const handleSaveSelectedArticle = () => {
    if (!selectedArticle) return;
    const payload: Record<string, unknown> = {
      title: articleTitle,
      body_json: articleBody,
      sort_order: articleSortOrder,
      category_id: articleCategoryId || selectedArticle.category_id,
    };
    if (pinnedIntent === "pin") {
      payload.pinned = true;
    }
    if (pinnedIntent === "unpin") {
      payload.pinned = false;
    }
    if (archiveIntent === "archive") {
      payload.archived_at = new Date().toISOString();
    }
    if (archiveIntent === "unarchive") {
      payload.archived_at = null;
    }
    updateArticleMutation.mutate({
      id: selectedArticle.id,
      payload,
    });
  };

  const handleTogglePinnedIntent = () => {
    if (!selectedArticle) return;
    setPinnedIntent((current) => {
      if (selectedArticle.pinned) {
        return current === "unpin" ? "none" : "unpin";
      }
      return current === "pin" ? "none" : "pin";
    });
  };

  const handleToggleArchiveIntent = () => {
    if (!selectedArticle) return;
    setArchiveIntent((current) => {
      if (selectedArticle.archived_at) {
        return current === "unarchive" ? "none" : "unarchive";
      }
      return current === "archive" ? "none" : "archive";
    });
  };

  const handleUploadWikiArticleImage = async (file: File) => {
    if (!selectedArticle) {
      throw new Error("Save article first before uploading images");
    }
    const uploaded = await uploadWikiArticleImages(selectedArticle.id, [file]);
    const key = uploaded.keys[0];
    if (!key) {
      throw new Error("Image upload returned no key");
    }
    return key;
  };

  const canCreateArticle = Boolean(articleCategoryId || selectedCategoryId || selectedCategoryIds[0] || categories[0]?.id);
  const canSaveCategoryDrafts = hasCategoryDraftChanges && !saveCategoryDraftsMutation.isPending;
  const handleCreateArticle = () =>
    createArticleMutation.mutate({
      title: articleTitle || t("articleEditor.defaultTitle"),
      category_id: articleCategoryId || selectedCategoryId || selectedCategoryIds[0] || categories[0]?.id || "",
      body_json: articleBody || TIPTAP_DEFAULT_JSON,
      sort_order: articleSortOrder,
    });

  const renderEditorPane = (mobileMode: boolean) => (
    <Stack
      className={`wiki-page-column ${mobileMode ? "wiki-page-column--mobile" : ""}`}
      style={{ width: "100%", alignItems: "stretch" }}
      gap={12}
    >
      {mobileMode ? (
        <Button size="xs" onClick={() => setMobilePane("list")} style={{ alignSelf: "flex-start" }}>
          {t("backToList")}
        </Button>
      ) : null}
      {editorTab === "categories" ? (
        <WikiCategoryEditorCard
          canEdit={canEdit}
          categoryName={categoryName}
          categoryDrafts={categoryDrafts}
          isCreating={createCategoryMutation.isPending}
          isSavingDrafts={saveCategoryDraftsMutation.isPending}
          canSaveDrafts={canSaveCategoryDrafts}
          deletingCategoryId={deletingCategoryId}
          onCategoryNameChange={setCategoryName}
          onCreateCategory={handleCreateCategory}
          onSaveDrafts={handleSaveCategoryDrafts}
          onCloseEditor={handleCloseCategoryEditorWithoutSave}
          onCategoryDraftNameChange={handleCategoryDraftNameChange}
          onCategoryDraftParentIdChange={handleCategoryDraftParentIdChange}
          onCategoryReorder={handleCategoryReorder}
          onDeleteCategory={handleDeleteCategory}
        />
      ) : (
        <WikiArticleEditorCard
          canEdit={canEdit}
          isCreatingArticle={isCreatingArticle}
          selectedArticle={selectedArticle}
          selectedCategory={selectedCategory}
          isLoading={false}
          isError={false}
          warningMessage={t("common:loadError")}
          articleTitle={articleTitle}
          articleBody={articleBody}
          articleCategoryId={articleCategoryId}
          categoryOptions={categoryOptions}
          pinnedIntent={pinnedIntent}
          archiveIntent={archiveIntent}
          isSaving={updateArticleMutation.isPending}
          isCreating={createArticleMutation.isPending}
          canCreateArticle={canCreateArticle}
          onArticleTitleChange={setArticleTitle}
          onArticleBodyChange={setArticleBody}
          onArticleCategoryChange={setArticleCategoryId}
          onSaveArticle={handleSaveSelectedArticle}
          onTogglePinnedIntent={handleTogglePinnedIntent}
          onToggleArchiveIntent={handleToggleArchiveIntent}
          onCreateArticle={handleCreateArticle}
          onExitEditor={handleExitArticleEditor}
          onImageUpload={handleUploadWikiArticleImage}
          emptyTitle={t("empty")}
        />
      )}
    </Stack>
  );

  const renderReaderPane = (mobileMode: boolean) => (
    <Stack
      className={`wiki-page-column ${mobileMode ? "wiki-page-column--mobile" : ""}`}
      style={{ width: "100%", alignItems: "stretch" }}
      gap={12}
    >
      {mobileMode ? (
        <Button size="xs" onClick={() => setMobilePane("list")} style={{ alignSelf: "flex-start" }}>
          {t("backToList")}
        </Button>
      ) : null}
      <InfiniCard className="wiki-article-reader-card" interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Stack gap={12}>
            {!selectedArticle ? (
              <EmptyState title={t("empty")} />
            ) : (
              <>
                <Group justify="space-between" align="start">
                  <Text fw={700} size="lg">
                    {selectedArticle.title}
                  </Text>
                  {canEdit ? (
                    <Tooltip label={t("editor.editWiki")} withArrow>
                      <DepthButton type="secondary" size="sm" onClick={handleOpenArticleEditor}>
                        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          <IconEdit size={16} />
                        </span>
                        <VisuallyHidden>{t("editor.editWiki")}</VisuallyHidden>
                      </DepthButton>
                    </Tooltip>
                  ) : null}
                </Group>
                <Group gap={6}>
                  <Text size="sm">{t("title")}</Text>
                  <Text size="sm" c="dimmed">
                    /
                  </Text>
                  <Text size="sm">{selectedCategory?.name ?? t("articleEditor.categoryFallback")}</Text>
                </Group>
                <Text c="dimmed" size="sm">
                  {t("articleEditor.lastUpdatedBy", { user: selectedArticle.created_by, date: formatDateTime(selectedArticle.updated_at) })}
                </Text>
                {selectedArticle.archived_at ? (
                  <Text c="infini-warning" size="sm">
                    {t("articleEditor.archivedAt", { date: formatDateTime(selectedArticle.archived_at) })}
                  </Text>
                ) : null}
                <TipTapEditor
                  value={selectedArticle.body_json}
                  onChange={() => {
                    // Read-only pane intentionally ignores editor updates.
                  }}
                  editable={false}
                />
              </>
            )}
          </Stack>
        </div>
      </InfiniCard>
    </Stack>
  );

  useLoadWarningToast(
    categoriesQuery.isError || articlesQuery.isError || detailQuery.isError,
    t("common:loadErrorRetry"),
  );

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")}>
      <PageLayout.Section>
        <InfiniCard interactive={false}>
          <div style={{ padding: "1.2rem" }}>
            <Group gap={8} wrap="wrap">
              <TextInput
                style={{ width: 300 }}
                placeholder={t("filter.search")}
                aria-label={t("filter.searchAria")}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
              <Tooltip label={pinnedOnly ? t("filter.showAll") : t("filter.showPinned")} withArrow>
                <DepthToggle
                  pressed={pinnedOnly}
                  onToggle={() => setPinnedOnly((value) => !value)}
                  type="secondary"
                  size="sm"
                  iconOnly
                  aria-label={pinnedOnly ? t("filter.showAll") : t("filter.showPinned")}
                >
                  <IconPinned size={16} />
                </DepthToggle>
              </Tooltip>
              <Tooltip label={archivedOnly ? t("filter.showActive") : t("filter.showArchived")} withArrow>
                <DepthToggle
                  pressed={archivedOnly}
                  onToggle={() => setArchivedOnly((value) => !value)}
                  type="secondary"
                  size="sm"
                  iconOnly
                  aria-label={archivedOnly ? t("filter.showActive") : t("filter.showArchived")}
                >
                  <IconArchive size={16} />
                </DepthToggle>
              </Tooltip>
            </Group>
          </div>
        </InfiniCard>
      </PageLayout.Section>

      <div className={`wiki-page-grid ${isMobile ? "wiki-page-grid--mobile" : ""}`}>
        {!isMobile || mobilePane === "list" ? (
          <Stack
            className={`wiki-page-column ${isMobile ? "wiki-page-column--mobile" : ""}`}
            style={{ width: "100%", alignItems: "stretch" }}
            gap={12}
          >
            <WikiArticleListCard
              title={t("articles.title")}
              canEdit={canEdit}
              createLabel={t("articleEditor.create")}
              onCreateArticle={handleStartCreateArticle}
              onOpenCategoryEditor={handleOpenCategoryEditor}
              categoryOptions={categoryOptions}
              selectedCategoryIds={selectedCategoryIds}
              onCategoryFilterChange={handleCategoryFilterChange}
              isLoading={false}
              isError={false}
              warningMessage={t("common:loadError")}
              articles={articles}
              selectedSlug={selectedSlug}
              emptyTitle={t("empty")}
              onSelectArticle={handleSelectArticle}
            />
          </Stack>
        ) : null}

        {!isMobile ? (
          isEditorPaneVisible ? renderEditorPane(false) : renderReaderPane(false)
        ) : (
          <Drawer
            position="right"
            size="100%"
            title={selectedArticle?.title ?? t("articleEditor.title")}
            opened={mobilePane === "article"}
            onClose={() => setMobilePane("list")}
            keepMounted={false}
          >
            {isEditorPaneVisible ? renderEditorPane(true) : renderReaderPane(true)}
          </Drawer>
        )}
      </div>
    </PageLayout>
  );
}
