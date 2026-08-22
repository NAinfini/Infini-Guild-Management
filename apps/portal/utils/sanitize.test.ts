import { describe, expect, it } from "vitest";
import { sanitizeTitleHtml } from "./sanitize";

describe("sanitizeTitleHtml", () => {
  it("removes executable markup from custom profile titles", () => {
    const sanitized = sanitizeTitleHtml('<img src=x onerror=alert(1)><span style="color:red">Leader</span><script>alert(2)</script>');

    expect(sanitized).toBe('<span style="color:red">Leader</span>');
  });
});
