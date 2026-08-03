import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { hasMediaQuotaCapacity } from "./service-factory";

describe("media quota capacity", () => {
  it("counts existing R2 objects under the entity prefix", async () => {
    const list = vi.fn().mockResolvedValue({
      objects: [
        { key: "gallery/users/user-1/items/item-a/images/a.webp" },
        { key: "gallery/users/user-1/items/item-b/images/b.webp" },
      ],
      truncated: false,
    });
    const c = {
      env: { MEDIA: { list } },
    } as unknown as Context;

    await expect(hasMediaQuotaCapacity(c, "gallery/users/user-1/items/", 2, 4)).resolves.toBe(true);
    await expect(hasMediaQuotaCapacity(c, "gallery/users/user-1/items/", 3, 4)).resolves.toBe(false);
    expect(list).toHaveBeenCalledWith({
      prefix: "gallery/users/user-1/items/",
      limit: 4,
    });
  });
});
