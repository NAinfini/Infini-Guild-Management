import type { Request } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { matchesApiResponse } from "./api-expectation";

function response(path: string, method = "GET") {
  return {
    url: () => `http://localhost${path}`,
    request: () => ({ method: () => method }) as Request,
  };
}

describe("E2E API response matching", () => {
  it("distinguishes the requested search from later background requests on the same path", () => {
    const expected = { method: "GET", path: /^\/api\/gallery$/, query: { search: "this run" } } as const;
    const background = response("/api/gallery?limit=20");
    const otherSearch = response("/api/gallery?search=old");
    const searched = response("/api/gallery?limit=20&search=this+run");

    expect([background, otherSearch, searched].filter((candidate) => matchesApiResponse(candidate, expected)))
      .toEqual([searched]);
  });

  it("requires the method, path and every specified filter to match", () => {
    const expected = {
      method: "GET", path: /^\/api\/wiki\/articles$/,
      query: { search: "release", category_id: "guides", archived: "true" },
    } as const;
    const matchingPath = "/api/wiki/articles?archived=true&category_id=guides&search=release";

    expect(matchesApiResponse(response(matchingPath), expected)).toBe(true);
    expect(matchesApiResponse(response(matchingPath, "POST"), expected)).toBe(false);
    expect(matchesApiResponse(response(matchingPath.replace("articles?", "categories?")), expected)).toBe(false);
    expect(matchesApiResponse(response(matchingPath.replace("archived=true", "archived=false")), expected)).toBe(false);
  });
});
