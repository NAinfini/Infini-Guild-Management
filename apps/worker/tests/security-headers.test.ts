import { describe, expect, it } from "vitest";
import { buildSpaHtmlCsp } from "../middleware/security-headers";

describe("buildSpaHtmlCsp", () => {
  it("allows same-origin ws connections for local HTTP requests", () => {
    const csp = buildSpaHtmlCsp("http://localhost:8788/dashboard");

    expect(csp).toContain("connect-src 'self' ws://localhost:8788");
    expect(csp).not.toContain("wss://localhost:8788");
  });

  it("allows same-origin wss connections for HTTPS requests", () => {
    const csp = buildSpaHtmlCsp("https://fanghuazhaoyun.com/dashboard");

    expect(csp).toContain("connect-src 'self' wss://fanghuazhaoyun.com");
    expect(csp).not.toContain("ws://fanghuazhaoyun.com");
  });
});
