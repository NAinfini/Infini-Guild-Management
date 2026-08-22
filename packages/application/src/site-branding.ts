import type { SiteConfigService } from "@guild/server";

/*
 * index.html 注入用的站点品牌，由公开站点配置推导。CF 与 VPS 的静态文件层
 * 共用这一份映射：媒体 logo 统一走受控的 /api/media/:id/view 端点，未配置
 * 时落回出厂 logo。
 */
export type StaticSiteBranding = Readonly<{
  siteName: string;
  siteDescription: string;
  siteLogoUrl: string;
}>;

export async function resolveStaticSiteBranding(
  siteConfig: Pick<SiteConfigService, "getPublic">,
): Promise<StaticSiteBranding> {
  const site = await siteConfig.getPublic();
  return {
    siteName: site.site_name,
    siteDescription: site.site_description,
    siteLogoUrl: site.site_logo_media_id
      ? `/api/media/${encodeURIComponent(site.site_logo_media_id)}/view`
      : site.default_site_logo_url,
  };
}
