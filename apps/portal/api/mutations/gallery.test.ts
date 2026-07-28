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

import { uploadGalleryImages } from "./gallery";

describe("uploadGalleryImages", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.convertFilesForUpload.mockReset();
  });

  it("passes the caller's abort signal to the upload request", async () => {
    const source = new File(["source"], "source.png", { type: "image/png" });
    const converted = new File(["converted"], "source.webp", { type: "image/webp" });
    const controller = new AbortController();
    mocks.convertFilesForUpload.mockResolvedValue([converted]);
    mocks.apiRequest.mockResolvedValue({ data: [] });

    await uploadGalleryImages([source], ["Guild night"], { signal: controller.signal });

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
    expect(mocks.convertFilesForUpload).not.toHaveBeenCalled();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
