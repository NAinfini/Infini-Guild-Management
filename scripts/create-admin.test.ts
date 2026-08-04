import { describe, expect, it } from "vitest";
import { buildAdminSql, createPasswordHash, findCount } from "./create-admin.mjs";

describe("first administrator setup", () => {
  it("uses the same deterministic PBKDF2 shape as Worker authentication", async () => {
    const salt = new Uint8Array(16);
    const result = await createPasswordHash("correct horse battery staple", salt);

    expect(result.salt).toBe("AAAAAAAAAAAAAAAAAAAAAA==");
    expect(result.passwordHash).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("escapes SQL values and only inserts into an empty users table", () => {
    const sql = buildAdminSql({
      userId: "user-id",
      profileId: "profile-id",
      username: "owner'name",
      passwordHash: "hash",
      salt: "salt",
    });

    expect(sql).toContain("owner''name");
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM users)");
    expect(sql).not.toContain("owner'name");
    expect(sql).toContain("member_profiles (id, user_id, power, video_urls)");
    expect(sql).not.toMatch(/member_profiles \([^)]*\b(classes|images)\b/);
  });

  it("finds Wrangler D1 counts inside nested JSON output", () => {
    expect(findCount([{ results: [{ count: 0 }] }])).toBe(0);
    expect(findCount({ result: [{ count: "3" }] })).toBe(3);
    expect(findCount({ results: [] })).toBeNull();
  });
});
