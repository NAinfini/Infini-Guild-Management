export {
  createWikiArticle,
  createWikiCategory,
  deleteWikiCategory,
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
  fetchWikiArticles,
  fetchWikiCategories,
} from "../api/queries/wiki";
