export {
  batchUpdateWikiCategories,
  createWikiArticle,
  createWikiCategory,
  deleteWikiArticle,
  deleteWikiCategory,
  restoreWikiArticleRevision,
  updateWikiArticle,
  uploadWikiArticleImages,
} from "../api/mutations/wiki";
export type {
  CreateWikiArticlePayload,
  CreateWikiCategoryPayload,
  UpdateWikiArticlePayload,
} from "../api/mutations/wiki";
export {
  fetchWikiArticleBySlug,
  fetchWikiArticleRevision,
  fetchWikiArticleRevisions,
  fetchWikiArticles,
  fetchWikiCategories,
} from "../api/queries/wiki";
