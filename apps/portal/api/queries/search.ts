import { apiRequest } from "../client";

export type SearchResultType = "user" | "event" | "announcement" | "wiki" | "gallery" | "war";

export type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  type: SearchResultType;
  to: string;
  entity_id?: string;
  role?: string;
  role_name?: string;
  role_color?: string | null;
  role_level?: number;
};

export type SearchResponse = { data: SearchResult[] };

export function searchGlobal(query: string, limit = 24): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  return apiRequest<SearchResponse>(`/api/search?${params.toString()}`);
}
