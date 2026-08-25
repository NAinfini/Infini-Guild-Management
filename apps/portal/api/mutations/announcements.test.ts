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
  uploadAnnouncementAttachment,
  uploadAnnouncementImages,
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

describe("announcement image mutations", () => {
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

  it("uploads full/view pairs directly to an existing announcement", async () => {
    const source = new File(["source"], "source.png", { type: "image/png" });
    mocks.apiRequest.mockResolvedValue({ media_ids: [mediaId] });

    await expect(uploadAnnouncementImages("announcement-1", [source])).resolves.toEqual({
      media_ids: [mediaId],
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/announcements/announcement-1/images",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
  });

  it("uploads one announcement attachment through the staged media endpoint", async () => {
    const file = new File(["%PDF-1.7"], "guild-guide.pdf", { type: "application/pdf" });
    const response = {
      expires_at: "2026-07-29T00:00:00.000Z",
      attachment: {
        media_id: mediaId,
        name: file.name,
        content_type: "application/pdf",
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
});
