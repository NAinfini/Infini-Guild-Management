// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  convertFilesForUpload: vi.fn(),
}));

vi.mock("../client", () => ({
  apiRequest: mocks.apiRequest,
}));

vi.mock("@guild/shared/utils/media", () => ({
  convertFilesForUpload: mocks.convertFilesForUpload,
}));

import {
  createAnnouncement,
  stageAnnouncementImages,
} from "./announcements";

const stagingResponse = {
  staging_id: "nanoid1234567890abcde",
  staging_token: "signed-announcement-staging-token".repeat(3),
  expires_at: "2026-07-29T00:00:00.000Z",
  keys: ["announcement/nanoid1234567890abcde/images/image-1"],
};

describe("announcement image staging mutations", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.convertFilesForUpload.mockReset();
  });

  it("starts staging without creating an announcement record", async () => {
    const source = new File(["source"], "source.png", { type: "image/png" });
    const converted = new File(["converted"], "source.webp", { type: "image/webp" });
    mocks.convertFilesForUpload.mockResolvedValue([converted]);
    mocks.apiRequest.mockResolvedValue(stagingResponse);

    await expect(stageAnnouncementImages(null, [source])).resolves.toEqual(stagingResponse);

    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    const [path, request] = mocks.apiRequest.mock.calls[0] as [string, { method: string; body: FormData }];
    expect(path).toBe("/api/announcements/images/stage");
    expect(request.method).toBe("POST");
    expect(request.body.getAll("files")).toEqual([converted]);
    expect(request.body.has("staging_token")).toBe(false);
  });

  it("reuses the signed token for later staged uploads", async () => {
    const source = new File(["source"], "source.png", { type: "image/png" });
    mocks.convertFilesForUpload.mockResolvedValue([source]);
    mocks.apiRequest.mockResolvedValue(stagingResponse);

    await stageAnnouncementImages(stagingResponse.staging_token, [source]);

    const request = mocks.apiRequest.mock.calls[0]?.[1] as { body: FormData };
    expect(request.body.get("staging_token")).toBe(stagingResponse.staging_token);
  });

  it("sends the staging token only when the announcement is explicitly saved", async () => {
    mocks.apiRequest.mockResolvedValue({ id: stagingResponse.staging_id });

    await createAnnouncement({
      title: "Maintenance",
      body_json: '{"type":"doc","content":[]}',
      staging_token: stagingResponse.staging_token,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/announcements",
      expect.objectContaining({
        method: "POST",
        bodyJson: expect.objectContaining({
          staging_token: stagingResponse.staging_token,
        }),
      }),
    );
  });
});
