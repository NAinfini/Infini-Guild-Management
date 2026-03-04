import { hasRoleAtLeast, type WikiCategory } from "@guild/shared";
import { Button, Drawer, Group, Select, Stack, TextInput } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  archiveWikiArticle,
  createWikiArticle,
  createWikiCategory,
  rollbackWikiArticleVersion,
  uploadWikiArticleImages,
  updateWikiArticle,
  updateWikiCategory,
} from "../../api/mutations/wiki";
import {
  compareWikiArticleVersions,
  fetchWikiArticleBySlug,
  fetchWikiArticles,
  fetchWikiArticleVersions,
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
import { WikiCategoryEditorCard } from "../feature/wiki/WikiCategoryEditorCard";
import { WikiCategoryTreeCard } from "../feature/wiki/WikiCategoryTreeCard";
import { PageLayout } from "../layout/PageLayout";
import { TIPTAP_DEFAULT_JSON } from "../shared/TipTapEditor";
import "./WikiPage.css";

type DataNode = {
  key: string;
  title: string;
  children?: DataNode[];
  disabled?: boolean;
};

function buildTreeData(categories: WikiCategory[]): DataNode[] {
  const byParent = new Map<string | null, WikiCategory[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category);
    byParent.set(category.parent_id, list);
  }

  const makeNode = (category: WikiCategory): DataNode => ({
    title: category.name,
    key: category.id,
    children: (byParent.get(category.id) ?? []).map(makeNode),
  });

  return (byParent.get(null) ?? []).map(makeNode);
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
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(routeSlug);

  const [categoryName, setCategoryName] = useState("");
  const [categorySortOrder, setCategorySortOrder] = useState(0);

  const [articleTitle, setArticleTitle] = useState("");
  const [articleBody, setArticleBody] = useState(TIPTAP_DEFAULT_JSON);
  const [articleSortOrder, setArticleSortOrder] = useState(0);
  const [articleCategoryId, setArticleCategoryId] = useState<string>("");
  const [isCreatingArticle, setIsCreatingArticle] = useState(false);
  const [selectedFromVersionId, setSelectedFromVersionId] = useState("");
  const [selectedToVersionId, setSelectedToVersionId] = useState("");
  const [mobilePane, setMobilePane] = useState<"list" | "article">("list");

  const categoriesQuery = useQuery({
    queryKey: queryKeys.wiki.categories(),
    queryFn: fetchWikiCategories,
  });

  const articlesQuery = useQuery({
    queryKey: queryKeys.wiki.articles(selectedCategoryId ?? "all", search, archivedOnly ? "archived" : "active"),
    queryFn: () =>
      fetchWikiArticles({
        page: 1,
        limit: 100,
        category_id: selectedCategoryId,
        search: search.trim() || undefined,
        archived: archivedOnly,
      }),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.wiki.article(selectedSlug),
    enabled: Boolean(selectedSlug),
    queryFn: () => fetchWikiArticleBySlug(selectedSlug as string),
  });

  const versionsQuery = useQuery({
    queryKey: queryKeys.wiki.articleVersions(detailQuery.data?.id ?? "none"),
    enabled: Boolean(detailQuery.data?.id),
    queryFn: () =>
      fetchWikiArticleVersions({
        articleId: detailQuery.data?.id as string,
        page: 1,
        limit: 50,
      }),
  });

  const versionCompareQuery = useQuery({
    queryKey: queryKeys.wiki.articleVersionsCompare(
      detailQuery.data?.id ?? "none",
      selectedFromVersionId || "none",
      selectedToVersionId || "none",
    ),
    enabled: Boolean(detailQuery.data?.id && selectedFromVersionId && selectedToVersionId),
    queryFn: () =>
      compareWikiArticleVersions({
        articleId: detailQuery.data?.id as string,
        fromVersionId: selectedFromVersionId,
        toVersionId: selectedToVersionId,
      }),
  });

  const createCategoryMutation = useMutation({
    mutationFn: createWikiCategory,
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.categoryCreated") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
      setCategoryName("");
      setCategorySortOrder(0);
    },
    onError: (error) => {
      showError(error, t("message.categoryCreateFailed"));
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      updateWikiCategory(id, payload),
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.categorySaved") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.categories() });
    },
    onError: (error) => {
      showError(error, t("message.categorySaveFailed"));
    },
  });

  const createArticleMutation = useMutation({
    mutationFn: createWikiArticle,
    onSuccess: async (created) => {
      notifications.show({ color: "green", message: t("message.articleCreated") });
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
    onSuccess: async (updated) => {
      notifications.show({ color: "green", message: t("message.articleSaved") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      if (selectedSlug) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.article(selectedSlug) });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.articleVersions(updated.id) });
    },
    onError: (error) => {
      showError(error, t("message.articleSaveFailed"));
    },
  });

  const archiveArticleMutation = useMutation({
    mutationFn: archiveWikiArticle,
    onSuccess: async () => {
      notifications.show({ color: "green", message: t("message.articleArchived") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      setSelectedSlug(null);
      void navigate({ to: "/wiki" });
    },
    onError: (error) => {
      showError(error, t("message.articleArchiveFailed"));
    },
  });

  const rollbackVersionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedArticle || !selectedToVersionId) {
        throw new Error("Missing target version for rollback");
      }
      return rollbackWikiArticleVersion(selectedArticle.id, selectedToVersionId);
    },
    onSuccess: async (updated) => {
      notifications.show({ color: "green", message: t("message.versionRolledBack") });
      setSelectedSlug(updated.slug);
      await navigate({ to: "/wiki/$slug", params: { slug: updated.slug } });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.article(updated.slug) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.articleVersions(updated.id) });
    },
    onError: (error) => {
      showError(error, t("message.versionRollbackFailed"));
    },
  });

  const categories = categoriesQuery.data ?? [];
  const articles = articlesQuery.data?.data ?? [];
  const selectedArticle = detailQuery.data ?? null;
  const treeData = useMemo(() => buildTreeData(categories), [categories]);

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
        void navigate({ to: "/wiki/$slug", params: { slug: firstSlug } });
      }
    }
  }, [articles, isCreatingArticle, navigate, selectedSlug]);

  useEffect(() => {
    if (!isMobile) {
      setMobilePane("list");
    }
  }, [isMobile]);

  useEffect(() => {
    if (!selectedArticle) return;
    setIsCreatingArticle(false);
    setArticleTitle(selectedArticle.title);
    setArticleBody(selectedArticle.body_json);
    setArticleSortOrder(selectedArticle.sort_order);
    setArticleCategoryId(selectedArticle.category_id);
    setSelectedFromVersionId("");
    setSelectedToVersionId("");
  }, [selectedArticle]);

  useEffect(() => {
    const versions = versionsQuery.data?.data ?? [];
    if (versions.length === 0) {
      if (selectedFromVersionId) setSelectedFromVersionId("");
      if (selectedToVersionId) setSelectedToVersionId("");
      return;
    }

    if (!selectedFromVersionId || !versions.some((item) => item.id === selectedFromVersionId)) {
      setSelectedFromVersionId(versions[0]?.id ?? "");
    }

    if (!selectedToVersionId || !versions.some((item) => item.id === selectedToVersionId)) {
      setSelectedToVersionId(versions[1]?.id ?? versions[0]?.id ?? "");
    }
  }, [selectedFromVersionId, selectedToVersionId, versionsQuery.data?.data]);

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const categoriesById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const selectedCategory = selectedArticle ? categoriesById.get(selectedArticle.category_id) ?? null : null;
  const isDirty = useMemo(() => {
    if (!canEdit) return false;
    if (selectedArticle) {
      return (
        articleTitle !== selectedArticle.title ||
        articleBody !== selectedArticle.body_json ||
        articleSortOrder !== selectedArticle.sort_order ||
        articleCategoryId !== selectedArticle.category_id
      );
    }
    return (
      categoryName.trim().length > 0 ||
      categorySortOrder !== 0 ||
      articleTitle.trim().length > 0 ||
      articleBody !== TIPTAP_DEFAULT_JSON ||
      articleSortOrder !== 0 ||
      articleCategoryId.trim().length > 0
    );
  }, [
    articleBody,
    articleCategoryId,
    articleSortOrder,
    articleTitle,
    categoryName,
    categorySortOrder,
    canEdit,
    selectedArticle,
  ]);
  useBeforeUnloadPrompt(isDirty);

  const handleSelectArticle = (slug: string) => {
    setIsCreatingArticle(false);
    setSelectedSlug(slug);
    void navigate({ to: "/wiki/$slug", params: { slug } });
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleStartCreateArticle = () => {
    setIsCreatingArticle(true);
    setSelectedSlug(null);
    setArticleTitle("");
    setArticleBody(TIPTAP_DEFAULT_JSON);
    setArticleSortOrder(0);
    setArticleCategoryId(selectedCategoryId ?? categories[0]?.id ?? "");
    if (routeSlug) {
      void navigate({ to: "/wiki" });
    }
    if (isMobile) {
      setMobilePane("article");
    }
  };

  const handleCreateCategory = () =>
    createCategoryMutation.mutate({
      name: categoryName || t("categoryEditor.defaultName"),
      sort_order: categorySortOrder,
      parent_id: selectedCategoryId,
    });

  const handleSaveSelectedCategory = () => {
    if (!selectedCategoryId) return;
    updateCategoryMutation.mutate({
      id: selectedCategoryId,
      payload: {
        name: categoryName || undefined,
        sort_order: categorySortOrder,
      },
    });
  };

  const handleSaveSelectedArticle = () => {
    if (!selectedArticle) return;
    updateArticleMutation.mutate({
      id: selectedArticle.id,
      payload: {
        title: articleTitle,
        body_json: articleBody,
        sort_order: articleSortOrder,
        category_id: articleCategoryId || selectedArticle.category_id,
      },
    });
  };

  const handleArchiveSelectedArticle = () => {
    if (!selectedArticle) return;
    archiveArticleMutation.mutate(selectedArticle.id);
  };

  const handleUnarchiveSelectedArticle = () => {
    if (!selectedArticle) return;
    updateArticleMutation.mutate({
      id: selectedArticle.id,
      payload: { archived_at: null },
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

  const canCreateArticle = Boolean(articleCategoryId || selectedCategoryId || categories[0]?.id);
  const handleCreateArticle = () =>
    createArticleMutation.mutate({
      title: articleTitle || t("articleEditor.defaultTitle"),
      category_id: articleCategoryId || selectedCategoryId || categories[0]?.id || "",
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
          Back to list
        </Button>
      ) : null}
      <WikiCategoryEditorCard
        canEdit={canEdit}
        categoryName={categoryName}
        categorySortOrder={categorySortOrder}
        selectedCategoryId={selectedCategoryId}
        isCreating={createCategoryMutation.isPending}
        isSaving={updateCategoryMutation.isPending}
        onCategoryNameChange={setCategoryName}
        onCategorySortOrderChange={setCategorySortOrder}
        onCreateCategory={handleCreateCategory}
        onSaveSelectedCategory={handleSaveSelectedCategory}
      />
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
        articleSortOrder={articleSortOrder}
        articleCategoryId={articleCategoryId}
        categoryOptions={categoryOptions}
        isSaving={updateArticleMutation.isPending}
        isArchiving={archiveArticleMutation.isPending}
        isCreating={createArticleMutation.isPending}
        canCreateArticle={canCreateArticle}
        onArticleTitleChange={setArticleTitle}
        onArticleBodyChange={setArticleBody}
        onArticleSortOrderChange={setArticleSortOrder}
        onArticleCategoryChange={setArticleCategoryId}
        onSaveArticle={handleSaveSelectedArticle}
        onArchiveArticle={handleArchiveSelectedArticle}
        onUnarchiveArticle={handleUnarchiveSelectedArticle}
        onCreateArticle={handleCreateArticle}
        onImageUpload={handleUploadWikiArticleImage}
        versionRows={versionsQuery.data?.data ?? []}
        versionsLoading={versionsQuery.isLoading}
        versionsError={versionsQuery.isError}
        selectedFromVersionId={selectedFromVersionId}
        selectedToVersionId={selectedToVersionId}
        versionCompareLoading={versionCompareQuery.isLoading}
        versionCompare={versionCompareQuery.data ?? null}
        rollbackPending={rollbackVersionMutation.isPending}
        onSelectFromVersionId={setSelectedFromVersionId}
        onSelectToVersionId={setSelectedToVersionId}
        onRollbackToVersion={() => rollbackVersionMutation.mutate()}
        emptyTitle={t("empty")}
      />
    </Stack>
  );

  useLoadWarningToast(
    categoriesQuery.isError || articlesQuery.isError || detailQuery.isError || versionsQuery.isError || versionCompareQuery.isError,
    t("common:loadErrorRetry"),
  );

  return (
    <PageLayout title={t("title")} subtitle="Knowledge Base">
      <PageLayout.Section>
        <InfiniCard>
          <div style={{ padding: "1.2rem" }}>
            <Group gap={8} wrap="wrap">
              <TextInput
                style={{ width: 300 }}
                placeholder={t("filter.search")}
                aria-label="Search wiki articles"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
              <Button onClick={() => setArchivedOnly((value) => !value)}>
                {archivedOnly ? "Show Active" : "Show Archived"}
              </Button>
              <Button onClick={() => setSelectedCategoryId(undefined)}>{t("filter.allCategories")}</Button>
              {isMobile ? (
                <Select
                  clearable
                  style={{ width: 220 }}
                  placeholder={t("filter.allCategories")}
                  aria-label="Filter wiki by category"
                  value={selectedCategoryId ?? null}
                  onChange={(value) => setSelectedCategoryId(value ?? undefined)}
                  data={categoryOptions}
                />
              ) : null}
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
            <WikiCategoryTreeCard
              title={t("categoryTree.title")}
              treeData={treeData}
              selectedCategoryId={selectedCategoryId}
              isLoading={false}
              isError={false}
              warningMessage={t("common:loadError")}
              emptyTitle={t("empty")}
              onSelectCategory={(categoryId) => {
                setSelectedCategoryId(categoryId);
                if (isMobile) {
                  setMobilePane("list");
                }
              }}
            />

            <WikiArticleListCard
              title={t("articles.title")}
              canEdit={canEdit}
              createLabel={t("articleEditor.create")}
              onCreateArticle={handleStartCreateArticle}
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
          renderEditorPane(false)
        ) : (
          <Drawer
            position="right"
            size="100%"
            title={selectedArticle?.title ?? t("articleEditor.title")}
            opened={mobilePane === "article"}
            onClose={() => setMobilePane("list")}
            keepMounted={false}
          >
            {renderEditorPane(true)}
          </Drawer>
        )}
      </div>
    </PageLayout>
  );
}
