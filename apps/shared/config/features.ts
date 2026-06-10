import { z } from "zod";

export interface FeatureFlags {
  announcements: boolean;
  events: boolean;
  guildWar: boolean;
  gallery: boolean;
  wiki: boolean;
  tools: boolean;
  equipmentCalc: boolean;
}

export const featureFlagsSchema = z.object({
  announcements: z.boolean(),
  events: z.boolean(),
  guildWar: z.boolean(),
  gallery: z.boolean(),
  wiki: z.boolean(),
  tools: z.boolean(),
  equipmentCalc: z.boolean(),
});

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  announcements: true,
  events: true,
  guildWar: true,
  gallery: true,
  wiki: true,
  tools: true,
  equipmentCalc: true,
};
