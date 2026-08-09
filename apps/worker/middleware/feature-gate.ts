import { type ErrorCode, type FeatureFlags, type StandardErrorResponse } from "@guild/shared";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getFeatureFlags } from "../routes/service-factory";

type FeatureKey = keyof FeatureFlags;

const API_FEATURE_REQUIREMENTS: ReadonlyArray<{
  prefix: string;
  features: readonly FeatureKey[];
}> = [
  { prefix: "/api/announcements", features: ["announcements"] },
  { prefix: "/api/events", features: ["events"] },
  { prefix: "/api/gallery", features: ["gallery"] },
  { prefix: "/api/guild-war", features: ["guildWar"] },
  { prefix: "/api/storage", features: ["storage"] },
  { prefix: "/api/wiki", features: ["wiki"] },
];

export function requiredFeaturesForApiPath(path: string): readonly FeatureKey[] {
  return API_FEATURE_REQUIREMENTS.find(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`))?.features ?? [];
}

export function areApiFeaturesEnabled(path: string, features: FeatureFlags): boolean {
  return requiredFeaturesForApiPath(path).every((feature) => features[feature]);
}

function buildFeatureDisabledError(c: Context): Response {
  const code: ErrorCode = "NOT_FOUND";
  const body: StandardErrorResponse = {
    error_code: code,
    message: "Feature is disabled",
    request_id: (c.get("requestId") as string | undefined) ?? crypto.randomUUID(),
  };
  return c.json(body, 404);
}

export const featureGateMiddleware = createMiddleware(async (c, next) => {
  const required = requiredFeaturesForApiPath(c.req.path);
  if (required.length === 0) {
    await next();
    return;
  }
  const features = await getFeatureFlags(c);
  if (!required.every((feature) => features[feature])) {
    return buildFeatureDisabledError(c);
  }
  await next();
});
