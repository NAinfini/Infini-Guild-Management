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

import { uploadGalleryImages } from "./gallery";

describe("uploadGalleryImages", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.convertImagesForUpload.mockReset();
    mocks.appendImageUploadVariants.mockReset();
  });

  it("uploads full/view pairs and passes the caller's abort signal", async () => {
    const source = new File(["source"], "source.png", { type: "image/png" });
    const variants = [{ full: {}, view: {} }];
    const controller = new AbortController();
    mocks.convertImagesForUpload.mockResolvedValue(variants);
    mocks.apiRequest.mockResolvedValue({ data: [] });

    await uploadGalleryImages([source], ["Guild night"], { signal: controller.signal });

    expect(mocks.appendImageUploadVariants).toHaveBeenCalledWith(expect.any(FormData), variants);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/gallery/images",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
      }),
    );
  });

  it("does not convert or send files when already cancelled", async () => {
    const source = new File(["source"], "source.png", { type: "image/png" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadGalleryImages([source], [], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.convertImagesForUpload).not.toHaveBeenCalled();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
