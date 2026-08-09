import { describe, expect, it } from "vitest";
import { verifyPassword } from "../apps/worker/services/auth";
import { buildAdminSql, createPasswordHash, findCount } from "./create-admin.mjs";

const USER_ID = "uuuuuuuuuuuuuuuuuuuuu";

describe("first administrator setup", () => {
  it("writes a hash the Worker login verifier accepts", async () => {
    const result = await createPasswordHash("correct horse battery staple");

    expect(result.passwordHash).toMatch(/^pbkdf2-sha256\$10000\$[A-Za-z0-9+/]{43}=$/);
    await expect(verifyPassword("correct horse battery staple", result.salt, result.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", result.salt, result.passwordHash)).resolves.toBe(false);
  });

  it("escapes SQL values and only inserts into an empty users table", () => {
    const sql = buildAdminSql({
      userId: USER_ID,
      username: "owner'name",
      passwordHash: "hash",
      salt: "salt",
    });

    expect(USER_ID).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(sql).toContain(`SELECT '${USER_ID}'`);
    expect(sql).toContain("owner''name");
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM users)");
    expect(sql).not.toContain("owner'name");
    expect(sql).toContain("member_profiles (user_id, power)");
    expect(sql).not.toContain("video_urls");
    expect(sql).not.toMatch(/member_profiles \([^)]*\b(classes|images)\b/);
  });

  it("finds Wrangler D1 counts inside nested JSON output", () => {
    expect(findCount([{ results: [{ count: 0 }] }])).toBe(0);
    expect(findCount({ result: [{ count: "3" }] })).toBe(3);
    expect(findCount({ results: [] })).toBeNull();
  });
});
