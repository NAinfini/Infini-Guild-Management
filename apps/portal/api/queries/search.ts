import type {
  Announcement,
  CursorResponse,
  Event,
  GalleryItem,
  MemberProfile,
  PaginatedResponse,
  User,
  WarHistory,
  WikiArticle,
} from "@guild/shared";
import type { FeatureFlags } from "@guild/shared/config/features";
import { apiRequest } from "../client";

export type SearchDataUserEntry = { user: User; profile: MemberProfile };
export type SearchDataResponse = {
  users: SearchDataUserEntry[];
  events: Event[];
  announcements: Announcement[];
  wikiArticles: WikiArticle[];
  warHistory: WarHistory[];
  galleryItems: GalleryItem[];
};

function disabled<T>(): Promise<T> {
  return Promise.reject(new Error("disabled"));
}

export async function fetchSearchData(features: FeatureFlags): Promise<SearchDataResponse> {
  const [usersResponse, eventsResponse, announcementsResponse, wikiResponse, warHistoryResponse, galleryResponse] =
    await Promise.allSettled([
      apiRequest<PaginatedResponse<SearchDataUserEntry>>("/api/users?page=1&limit=40&include_total=false"),
      features.events ? apiRequest<PaginatedResponse<Event>>("/api/events?page=1&limit=40") : disabled<PaginatedResponse<Event>>(),
      features.announcements ? apiRequest<PaginatedResponse<Announcement>>("/api/announcements?page=1&limit=25") : disabled<PaginatedResponse<Announcement>>(),
      features.wiki ? apiRequest<PaginatedResponse<WikiArticle>>("/api/wiki/articles?page=1&limit=25") : disabled<PaginatedResponse<WikiArticle>>(),
      features.guildWar ? apiRequest<PaginatedResponse<WarHistory>>("/api/guild-war/history?page=1&limit=25") : disabled<PaginatedResponse<WarHistory>>(),
      features.gallery ? apiRequest<CursorResponse<GalleryItem>>("/api/gallery?cursor=0&limit=25") : disabled<CursorResponse<GalleryItem>>(),
    ]);

  return {
    users: usersResponse.status === "fulfilled" ? usersResponse.value.data : [],
    events: eventsResponse.status === "fulfilled" ? eventsResponse.value.data : [],
    announcements: announcementsResponse.status === "fulfilled" ? announcementsResponse.value.data : [],
    wikiArticles: wikiResponse.status === "fulfilled" ? wikiResponse.value.data : [],
    warHistory: warHistoryResponse.status === "fulfilled" ? warHistoryResponse.value.data : [],
    galleryItems: galleryResponse.status === "fulfilled" ? galleryResponse.value.data : [],
  };
}
