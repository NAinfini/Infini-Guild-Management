import { describe, expect, it } from "vitest";
import { sanitizeInlineHtml } from "../inline-html";

describe("sanitizeInlineHtml", () => {
  it("keeps allowlisted tags and style declarations", () => {
    expect(sanitizeInlineHtml('<span style="color: #ff0000">Rank</span>')).toBe(
      '<span style="color: #ff0000">Rank</span>',
    );
    expect(sanitizeInlineHtml("<b>A</b><i>B</i><br>")).toBe("<b>A</b><i>B</i><br>");
  });

  it("removes tags that are not on the allowlist and escapes their text", () => {
    expect(sanitizeInlineHtml("<script>alert(1)</script>")).toBe("alert(1)");
    expect(sanitizeInlineHtml('<img src=x onerror="alert(1)">')).toBe("");
    expect(sanitizeInlineHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("drops every attribute except an allowlisted style", () => {
    expect(sanitizeInlineHtml('<span onclick="alert(1)">x</span>')).toBe("<span>x</span>");
    expect(sanitizeInlineHtml('<span style="color: red" onmouseover="alert(1)">x</span>')).toBe(
      '<span style="color: red">x</span>',
    );
  });

  it("drops style declarations that could load or evaluate anything", () => {
    expect(sanitizeInlineHtml('<span style="background-color: url(javascript:alert(1))">x</span>')).toBe(
      "<span>x</span>",
    );
    expect(sanitizeInlineHtml('<span style="color: expression(alert(1))">x</span>')).toBe("<span>x</span>");
    expect(sanitizeInlineHtml('<span style="behavior: url(#x)">x</span>')).toBe("<span>x</span>");
    expect(sanitizeInlineHtml('<span style="color: red; behavior: url(#x)">x</span>')).toBe(
      '<span style="color: red">x</span>',
    );
    expect(sanitizeInlineHtml('<span style="color: \\75 rl(x)">x</span>')).toBe("<span>x</span>");
  });

  it("cannot be tricked into emitting an unbalanced attribute", () => {
    // A `>` inside the attribute value must not let the payload escape the
    // quoted style attribute the sanitizer rebuilds.
    expect(sanitizeInlineHtml('<span style="color: red" x="><script>alert(1)</script>')).not.toContain("<script");
    expect(sanitizeInlineHtml('<span style="red&quot; onload=&quot;alert(1)">x</span>')).toBe("<span>x</span>");
  });
});
