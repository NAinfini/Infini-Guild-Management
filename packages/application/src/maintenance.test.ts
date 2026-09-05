import { describe, expect, it } from "vitest";
import {
  isMaintenanceModeEnabled,
  maintenanceResponse,
  readMaintenanceDetails,
} from "./maintenance.js";

describe("maintenance boundary", () => {
  it("is off when absent or explicit and fails closed for every other non-empty value", () => {
    expect(isMaintenanceModeEnabled(undefined)).toBe(false);
    expect(isMaintenanceModeEnabled("")).toBe(false);
    expect(isMaintenanceModeEnabled(" off ")).toBe(false);
    expect(isMaintenanceModeEnabled("on")).toBe(true);
    expect(isMaintenanceModeEnabled("true")).toBe(true);
  });

  it("serves a self-contained Chinese page by default with maintenance headers", async () => {
    const response = maintenanceResponse(new Request("https://guild.example/login"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
    expect(response.headers.get("Content-Language")).toBe("zh-CN");
    expect(response.headers.get("Vary")).toBe("Accept-Language");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    const body = await response.text();
    expect(body).toContain('<html lang="zh-Hans">');
    expect(body).toContain("系统维护中");
    expect(body).toContain("服务正在更新。完成后即可继续使用，请稍后重试。");
    expect(body).toContain('class="maintenance-icon"');
    expect(body).toContain('class="maintenance-action" href="">重试</a>');
    expect(body).not.toContain("Maintenance in progress");
    expect(body).not.toContain("Infini Guild");
    expect(body).not.toContain("芳华朝云");
    expect(body).not.toContain("maintenance-scene");
    expect(body).not.toContain("@keyframes");
    expect(body).not.toMatch(/<(?:script|link|img)\b/i);
  });

  it("honors weighted language preferences and safely renders public metadata", async () => {
    const details = readMaintenanceDetails({
      IG_MAINTENANCE_REASON: "  <database> & media update  ",
      IG_MAINTENANCE_UNTIL: "2026-08-30T12:00:00.000Z",
    });
    expect(details).toEqual({
      reason: "<database> & media update",
      until: "2026-08-30T12:00:00.000Z",
    });

    const response = maintenanceResponse(new Request("https://guild.example/", {
      headers: { "Accept-Language": "zh-Hans;q=0.4, en-US;q=0.9" },
    }), details);
    expect(response.headers.get("Content-Language")).toBe("en");
    const body = await response.text();
    expect(body).toContain('<html lang="en">');
    expect(body).toContain("Site under maintenance");
    expect(body).toContain("Maintenance details");
    expect(body).toContain("&lt;database&gt; &amp; media update");
    expect(body).toContain("Expected completion");
    expect(body).toContain('<time datetime="2026-08-30T12:00:00.000Z">August 30, 2026 at 12:00 UTC</time>');
    expect(body).not.toContain("<database>");
    expect(body).not.toContain("系统维护中");

    const health = maintenanceResponse(new Request("https://guild.example/api/health"), details);
    await expect(health.json()).resolves.toEqual({
      ok: true,
      maintenance: true,
      reason: "<database> & media update",
      until: "2026-08-30T12:00:00.000Z",
    });
  });

  it("prefers the highest supported language weight and falls back to Chinese", async () => {
    const chinese = maintenanceResponse(new Request("https://guild.example/", {
      headers: { "Accept-Language": "en;q=0.5, zh-CN;q=0.8" },
    }));
    expect(chinese.headers.get("Content-Language")).toBe("zh-CN");
    expect(await chinese.text()).toContain("系统维护中");

    const fallback = maintenanceResponse(new Request("https://guild.example/", {
      headers: { "Accept-Language": "fr-CA, en;q=0" },
    }));
    expect(fallback.headers.get("Content-Language")).toBe("zh-CN");
    expect(await fallback.text()).toContain("系统维护中");
  });

  it("rejects overlong reasons and non-canonical maintenance deadlines", () => {
    expect(() => readMaintenanceDetails({ IG_MAINTENANCE_REASON: "x".repeat(501) }))
      .toThrow(/IG_MAINTENANCE_REASON/);
    for (const value of ["2026-08-30T12:00:00Z", "2026-08-30T12:00:00.000+00:00", "not-a-date"]) {
      expect(() => readMaintenanceDetails({ IG_MAINTENANCE_UNTIL: value }))
        .toThrow(/IG_MAINTENANCE_UNTIL/);
    }
  });

  it("keeps health edge-only and returns the standard API error envelope", async () => {
    const health = maintenanceResponse(new Request("https://guild.example/api/health"));
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true, maintenance: true });

    const api = maintenanceResponse(new Request("https://guild.example/api/site-config"));
    expect(api.status).toBe(503);
    expect(api.headers.get("X-Request-Id")).toBeTruthy();
    await expect(api.json()).resolves.toEqual(expect.objectContaining({
      error_code: "UPSTREAM_ERROR",
      message: "Maintenance in progress / 系统维护中",
      request_id: expect.any(String),
    }));
  });

  it("returns no body for HEAD requests", async () => {
    const response = maintenanceResponse(new Request("https://guild.example/", {
      method: "HEAD",
      headers: { "Accept-Language": "en" },
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Language")).toBe("en");
    expect(await response.text()).toBe("");
  });
});
