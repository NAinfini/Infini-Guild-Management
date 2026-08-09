import { describe, expect, it, vi } from "vitest";
import { AttachmentService } from "../AttachmentService";

describe("AttachmentService", () => {
  it("prepares files with blob urls and preserves source files", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
    const service = new AttachmentService();
    const file = new File(["image"], "poster.png", { type: "image/png" });

    const items = await service.prepareFiles([file]);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(items).toEqual([
      expect.objectContaining({
        src: "blob:test-image",
        alt: "poster.png",
        file,
      }),
    ]);
  });

  it("extracts new files and existing media IDs from mixed items", () => {
    const service = new AttachmentService();
    const file = new File(["image"], "new.png", { type: "image/png" });

    const items = [
      { id: "media1234567890abcdef", src: "/api/media/media1234567890abcdef/view" },
      { id: "new", src: "blob:new", file },
    ];

    expect(service.extractExistingMediaIds(items)).toEqual(["media1234567890abcdef"]);
    expect(service.extractNewFiles(items)).toEqual([file]);
  });

  it("releases blob urls but ignores stable media urls", () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const service = new AttachmentService();

    service.releaseItem({ id: "blob", src: "blob:temp" });
    service.releaseItem({ id: "stable", src: "/api/media/media1234567890abcdef/view" });

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:temp");
  });
});
