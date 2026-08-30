import { describe, expect, it } from "vitest";
import {
  memberProfileMediaRevisionToken,
  memberProfileRevisionEtag,
} from "./member-profile-revision";

describe("member profile revision ETags", () => {
  it("renders an opaque revision token as a strong member profile ETag", () => {
    expect(memberProfileRevisionEtag("profile-v2")).toBe('"member-profile-profile-v2"');
  });

  it("derives a valid media aggregate revision from the audit event", () => {
    expect(memberProfileMediaRevisionToken("audit-1")).toBe("profile-audit-1");
  });
});
