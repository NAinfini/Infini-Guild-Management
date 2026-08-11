import { describe, expect, it } from "vitest";
import { sanitizeInlineHtml } from "./inline-html.js";

describe("sanitizeInlineHtml", () => {
  it("keeps the fixed inline tags and shared safe CSS values", () => {
    expect(sanitizeInlineHtml(
      '<span style="color: #ff0000; font-weight: 700; display: inline-block"><strong>Rank</strong><br></span>',
    )).toBe(
      '<span style="color: #ff0000; font-weight: 700; display: inline-block"><strong>Rank</strong><br></span>',
    );
  });

  it("cannot persist scripts, event handlers, or disallowed elements", () => {
    expect(sanitizeInlineHtml('<script>alert(1)</script><img src=x onerror="alert(2)"><b onclick="x">Safe</b>'))
      .toBe("alert(1)<b>Safe</b>");
  });

  it("drops executable CSS while retaining independent safe declarations", () => {
    expect(sanitizeInlineHtml(
      '<span style="color: red; background-color: url(javascript:x); behavior: url(#x); font-size: 20px">x</span>',
    )).toBe('<span style="color: red; font-size: 20px">x</span>');
    expect(sanitizeInlineHtml('<span style="color: \\75 rl(x)" x="><script>x</script>')).not.toContain("<script");
  });
});
