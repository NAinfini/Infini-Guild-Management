import type { CursorResponse, GalleryItem } from "@guild/shared";
import { apiRequest } from "../client";

export function fetchGallery(params: {
  cursor?: string;
  limit?: number;
  type?: "image" | "video";
  date_from?: string;
  date_to?: string;
  search?: string;
  order?: "asc" | "desc";
}): Promise<CursorResponse<GalleryItem>> {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? 24));
  if (params.type) query.set("type", params.type);
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);
  if (params.search) query.set("search", params.search);
  if (params.order) query.set("order", params.order);

  return apiRequest<CursorResponse<GalleryItem>>(`/api/gallery?${query.toString()}`);
}
