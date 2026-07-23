import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { hasMediaQuotaCapacity } from "./service-factory";

describe("media quota capacity", () => {
  it("counts existing R2 objects under the entity prefix", async () => {
    const list = vi.fn().mockResolvedValue({
      objects: [{ key: "gallery/images/user-1/a" }, { key: "gallery/images/user-1/b" }],
      truncated: false,
    });
    const c = {
      env: { MEDIA: { list } },
    } as unknown as Context;

    await expect(hasMediaQuotaCapacity(c, "gallery/images/user-1/", 2, 4)).resolves.toBe(true);
    await expect(hasMediaQuotaCapacity(c, "gallery/images/user-1/", 3, 4)).resolves.toBe(false);
    expect(list).toHaveBeenCalledWith({
      prefix: "gallery/images/user-1/",
      limit: 4,
    });
  });
});
