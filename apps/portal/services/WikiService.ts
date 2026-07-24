export {
  createWikiArticle,
  createWikiCategory,
  deleteWikiArticle,
  deleteWikiCategory,
  restoreWikiArticleRevision,
  updateWikiArticle,
  updateWikiCategory,
  uploadWikiArticleImages,
} from "../api/mutations/wiki";
export type {
  CreateWikiArticlePayload,
  CreateWikiCategoryPayload,
  UpdateWikiArticlePayload,
  UpdateWikiCategoryPayload,
} from "../api/mutations/wiki";
export {
  fetchWikiArticleBySlug,
  fetchWikiArticleRevision,
  fetchWikiArticleRevisions,
  fetchWikiArticles,
  fetchWikiCategories,
} from "../api/queries/wiki";
