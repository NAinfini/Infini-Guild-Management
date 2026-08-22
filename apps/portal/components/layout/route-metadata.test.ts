// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findPortalRoute,
  groupPortalRoutes,
  PORTAL_NAV_GROUPS,
  PORTAL_ROUTES,
} from "./route-metadata";

describe("portal route metadata", () => {
  it("keeps every destination unique and assigned to one layout contract", () => {
    const paths = PORTAL_ROUTES.map((route) => route.to);

    expect(new Set(paths).size).toBe(paths.length);
    expect(PORTAL_ROUTES.every((route) => route.contentWidth.length > 0)).toBe(true);
    expect(PORTAL_ROUTES.every((route) => PORTAL_NAV_GROUPS.some((group) => group.id === route.group))).toBe(true);
  });

  it("derives the stable mobile navigation from the same registry", () => {
    expect(
      PORTAL_ROUTES
        .filter((route) => route.mobilePrimary)
        .sort((left, right) => (left.mobilePrimary ?? 0) - (right.mobilePrimary ?? 0))
        .map((route) => route.to),
    ).toEqual(["/", "/events", "/guild-war", "/roster"]);
  });

  it("matches nested routes to their parent metadata", () => {
    expect(findPortalRoute("/events/event-1").to).toBe("/events");
    expect(findPortalRoute("/wiki/getting-started").to).toBe("/wiki");
    expect(findPortalRoute("/storage/manage").to).toBe("/storage");
  });

  it("uses the not-found title and reading width for unknown paths", () => {
    expect(findPortalRoute("/does-not-exist")).toMatchObject({
      labelKey: "notFound.title",
      contentWidth: "reading",
    });
  });

  it("keeps settings visible to guests in a standard-width workspace", () => {
    const settingsRoute = PORTAL_ROUTES.find((route) => route.to === "/settings");

    expect(settingsRoute).toMatchObject({
      contentWidth: "standard",
    });
    expect(settingsRoute?.requiresSession).not.toBe(true);
  });

  /*
   * 控制台、Wiki、公告、公会战、成员名册与个人资料都把纵向滚动收在自己内部，
   * 前提是外壳给出确定高度。这个开关一旦丢了，内容会按整页铺开，滚动条重新落回外壳。
   */
  it("locks the inner-scrolling workspaces to one viewport and leaves every other route free to grow", () => {
    expect(
      PORTAL_ROUTES.filter((route) => route.fillsViewport).map((route) => route.to).sort(),
    ).toEqual(["/admin", "/announcements", "/guild-war", "/profile", "/roster", "/wiki"]);
  });

  /*
   * 区域色的两半分居 TS 和 CSS：这里声明「哪条路由属于哪个区」，semantic.css
   * 声明「哪个区是什么颜色」。中间只靠一个字符串对上，拼错不会报错——只会安静地
   * 回落到 :root 的品牌色，那一页看起来「就是没上色」，谁也说不清哪里错了。
   * 这条把两半钉在一起。
   */
  it("matches every route domain to a [data-domain] block in semantic.css", () => {
    const semantic = readFileSync(
      resolve(import.meta.dirname, "../../styles/semantic.css"),
      "utf8",
    );
    const styled = new Set(
      [...semantic.matchAll(/\[data-domain="([a-z]+)"\]/g)].map((match) => match[1]!),
    );
    const routed = new Set(
      PORTAL_ROUTES.map((route) => route.domain).filter((domain) => domain !== undefined),
    );

    expect([...routed].sort()).toEqual([...styled].sort());
  });

  /*
   * 只有仪表盘不属于任何内容分区——它是「站点本身」，沿用用户选的强调色，
   * 好让首屏就露出那个选择。其余每一页都必须有自己的区域色。
   */
  it("gives every destination but the dashboard its own domain", () => {
    expect(
      PORTAL_ROUTES.filter((route) => route.domain === undefined).map((route) => route.to),
    ).toEqual(["/"]);
  });

  it("preserves the approved navigation hierarchy without empty groups", () => {
    const groups = groupPortalRoutes(PORTAL_ROUTES);

    expect(groups.map((group) => group.id)).toEqual([
      "overview",
      "community",
      "operations",
      "personal",
      "administration",
    ]);
    expect(groups.every((group) => group.routes.length > 0)).toBe(true);
  });
});
