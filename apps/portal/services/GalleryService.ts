export {
  batchDeleteGalleryItems,
  createGalleryVideo,
  deleteGalleryItem,
  likeGalleryItem,
  unlikeGalleryItem,
  updateGalleryItem,
  uploadGalleryImages,
} from "../api/mutations/gallery";
export type { CreateGalleryVideoPayload, UpdateGalleryItemPayload } from "../api/mutations/gallery";
export { fetchGallery } from "../api/queries/gallery";
