import { describe, expect, it } from "vitest";
import { isMaintenanceModeEnabled, maintenanceResponse } from "./maintenance.js";

describe("maintenance boundary", () => {
  it("is off when absent or explicit and fails closed for every other non-empty value", () => {
    expect(isMaintenanceModeEnabled(undefined)).toBe(false);
    expect(isMaintenanceModeEnabled("")).toBe(false);
    expect(isMaintenanceModeEnabled(" off ")).toBe(false);
    expect(isMaintenanceModeEnabled("on")).toBe(true);
    expect(isMaintenanceModeEnabled("true")).toBe(true);
  });

  it("serves a self-contained bilingual scene page with maintenance headers", async () => {
    const response = maintenanceResponse(new Request("https://guild.example/login"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    const body = await response.text();
    expect(body).toContain('计划维护 · <span lang="en">Scheduled maintenance</span>');
    expect(body).toContain("系统维护中");
    expect(body).toContain('<h2 lang="en">Maintenance in progress</h2>');
    expect(body).toContain('<p lang="en">We are safely updating data and media services.');
    expect(body).toContain("class=\"maintenance-scene\"");
    expect(body).toContain("<svg viewBox=\"0 0 1600 900\"");
    expect(body).not.toContain("@keyframes");
    expect(body).not.toMatch(/<(?:script|link|img)\b/i);
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
    const response = maintenanceResponse(new Request("https://guild.example/", { method: "HEAD" }));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
