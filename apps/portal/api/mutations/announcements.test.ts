import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  convertImagesForUpload: vi.fn(),
  appendImageUploadVariants: vi.fn(),
}));

vi.mock("../client", () => ({
  apiRequest: mocks.apiRequest,
}));

vi.mock("../../utils/upload-media", () => ({
  convertImagesForUpload: mocks.convertImagesForUpload,
  appendImageUploadVariants: mocks.appendImageUploadVariants,
}));

import {
  archiveAnnouncement,
  deleteAnnouncement,
  updateAnnouncement,
  uploadAnnouncementAttachment,
  uploadPendingAnnouncementImages,
} from "./announcements";

const mediaId = "media1234567890abcdef";
const imageVariants = [{
  full: new File(["full"], "source-full.webp", { type: "image/webp" }),
  view: new File(["view"], "source-view.webp", { type: "image/webp" }),
  fullWidth: 2400,
  fullHeight: 1600,
  viewWidth: 1620,
  viewHeight: 1080,
}];

describe("announcement mutations", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.convertImagesForUpload.mockReset();
    mocks.appendImageUploadVariants.mockReset();
    mocks.convertImagesForUpload.mockResolvedValue(imageVariants);
  });

  it("uploads pending full/view pairs without creating an announcement", async () => {
    const source = new File(["source"], "source.png", { type: "image/png" });
    const response = {
      expires_at: "2026-07-29T00:00:00.000Z",
      media_ids: [mediaId],
    };
    mocks.apiRequest.mockResolvedValue(response);

    await expect(uploadPendingAnnouncementImages([source])).resolves.toEqual(response);

    expect(mocks.convertImagesForUpload).toHaveBeenCalledWith([source]);
    expect(mocks.appendImageUploadVariants).toHaveBeenCalledWith(expect.any(FormData), imageVariants);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/announcements/images",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
  });

  it("uploads one announcement attachment through the staged media endpoint", async () => {
    const file = new File(["strategy"], "strategy.guildpack", { type: "application/x-guild-pack" });
    const response = {
      expires_at: "2026-07-29T00:00:00.000Z",
      attachment: {
        media_id: mediaId,
        name: file.name,
        content_type: "application/octet-stream",
        byte_size: file.size,
      },
    };
    mocks.apiRequest.mockResolvedValue(response);

    await expect(uploadAnnouncementAttachment(file)).resolves.toEqual(response);

    const formData = mocks.apiRequest.mock.calls[0]?.[1]?.body as FormData;
    expect(formData.getAll("file")).toEqual([file]);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/announcements/attachments",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
  });

  it("forwards the frozen aggregate ETag on update, archive, and permanent delete", async () => {
    const etag = '"announcement-announcement-1-2026-08-01T00:00:00.000Z"';
    mocks.apiRequest.mockResolvedValue({ ok: true });

    await updateAnnouncement("announcement-1", { title: "Updated" }, etag);
    await archiveAnnouncement("announcement-1", etag);
    await deleteAnnouncement("announcement-1", etag);

    expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, "/api/announcements/announcement-1", {
      method: "PATCH",
      bodyJson: { title: "Updated" },
      ifMatch: etag,
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, "/api/announcements/announcement-1", {
      method: "DELETE",
      ifMatch: etag,
    });
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(3, "/api/announcements/announcement-1/permanent", {
      method: "DELETE",
      ifMatch: etag,
    });
  });
});
