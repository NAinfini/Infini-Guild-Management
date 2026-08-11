import { describe, expect, it } from "vitest";
import { hashTableRows } from "./fingerprint";

describe("E2E cleanup fingerprint", () => {
  it("ignores opaque concurrency metadata while retaining member profile data", () => {
    const before = [{
      user_id: "user-1",
      bio: "same",
      revision_token: "revision-before",
      updated_at: "2026-08-01T00:00:00.000Z",
    }];
    const restored = [{
      ...before[0],
      revision_token: "revision-after",
      updated_at: "2026-08-10T00:00:00.000Z",
    }];
    expect(hashTableRows("member_profiles", restored)).toBe(hashTableRows("member_profiles", before));
    expect(hashTableRows("member_profiles", [{ ...restored[0], bio: "changed" }]))
      .not.toBe(hashTableRows("member_profiles", before));
  });

  it("treats the wiki category token as concurrency metadata, not an artifact", () => {
    const before = [{ singleton: 1, revision_token: "before", updated_at: "before" }];
    const after = [{ singleton: 1, revision_token: "after", updated_at: "after" }];
    expect(hashTableRows("wiki_category_state", after)).toBe(hashTableRows("wiki_category_state", before));
  });
});
