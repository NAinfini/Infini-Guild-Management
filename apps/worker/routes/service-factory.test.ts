import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { getAbsencePolicy, getFeatureFlags, getMediaPolicy, getStoragePolicy } from "./service-factory";

const POLICY_ROW = {
  feature_announcements_enabled: 1,
  feature_events_enabled: 1,
  feature_guild_war_enabled: 1,
  feature_gallery_enabled: 0,
  feature_wiki_enabled: 1,
  feature_tools_enabled: 1,
  feature_storage_enabled: 1,
  media_site_logo_max_bytes: 2 * 1024 * 1024,
  media_class_icon_max_bytes: 512 * 1024,
  media_profile_image_max_bytes: 5 * 1024 * 1024,
  media_profile_audio_max_bytes: 20 * 1024 * 1024,
  media_announcement_image_max_bytes: 5 * 1024 * 1024,
  media_wiki_image_max_bytes: 5 * 1024 * 1024,
  media_event_image_max_bytes: 5 * 1024 * 1024,
  media_gallery_image_max_bytes: 10 * 1024 * 1024,
  media_storage_image_max_bytes: 5 * 1024 * 1024,
  media_profile_quota: 10,
  media_announcement_quota: 10,
  media_gallery_quota: 20,
  media_wiki_quota: 10,
  storage_images_per_item: 5,
  absence_max_span_days: 366,
  absence_max_entries_per_user: 20,
};

function createContext(row: typeof POLICY_ROW | null) {
  const first = vi.fn().mockResolvedValue(row);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn((_sql: string) => ({ bind }));
  return {
    context: { env: { DB: { prepare } } } as unknown as Context,
    prepare,
    bind,
  };
}

describe("site policy service factory", () => {
  it("maps one relational singleton snapshot into every policy shape", async () => {
    const { context, prepare, bind } = createContext(POLICY_ROW);

    const [features, media, storage, absence] = await Promise.all([
      getFeatureFlags(context),
      getMediaPolicy(context),
      getStoragePolicy(context),
      getAbsencePolicy(context),
    ]);

    expect(features).toMatchObject({ gallery: false, storage: true });
    expect(media).toMatchObject({
      max_file_size_bytes: { class_icon: 512 * 1024 },
      quotas: { gallery: 20 },
    });
    expect(storage).toEqual({ images_per_item: 5 });
    expect(absence).toEqual({ max_span_days: 366, max_entries_per_user: 20 });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]?.[0]).toContain("feature_announcements_enabled");
    expect(bind).toHaveBeenCalledWith("default");
  });

  it("hard-fails when the singleton is missing", async () => {
    const { context } = createContext(null);

    await expect(getFeatureFlags(context)).rejects.toThrow(/site_config singleton.*missing/i);
  });

  it("hard-fails on an invalid relational boolean", async () => {
    const { context } = createContext({ ...POLICY_ROW, feature_events_enabled: 2 });

    await expect(getFeatureFlags(context)).rejects.toThrow(/feature_events_enabled/i);
  });
});
