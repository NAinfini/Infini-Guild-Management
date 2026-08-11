import { readApplicationConfig, type ApplicationConfig } from "@guild/application";

export type CloudflareRuntimeConfig = Readonly<{
  application: ApplicationConfig;
  localDevelopment: boolean;
}>;

export function readCloudflareRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): CloudflareRuntimeConfig {
  const application = readApplicationConfig(environment);
  const publicUrl = new URL(application.publicUrl);
  const localDevelopment = publicUrl.hostname === "localhost"
    || publicUrl.hostname === "127.0.0.1"
    || publicUrl.hostname === "[::1]";
  const isLoopbackHttp = publicUrl.protocol === "http:"
    && localDevelopment;
  if (publicUrl.protocol !== "https:" && !isLoopbackHttp) {
    throw new TypeError("Cloudflare IG_PUBLIC_URL must use HTTPS, except for loopback local development");
  }
  return Object.freeze({ application, localDevelopment });
}

export function cloudflareClientIdentifier(request: Request, localDevelopment = false): string {
  const value = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  if (!value && localDevelopment) return "127.0.0.1";
  if (!value || value.length > 64 || value.includes(",") || !/^[0-9A-Fa-f:.]+$/.test(value)) {
    throw new TypeError("Cloudflare did not provide a valid client address");
  }
  return value.toLowerCase();
}
