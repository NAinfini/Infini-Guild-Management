export interface FeatureFlags {
  announcements: boolean;
  events: boolean;
  guildWar: boolean;
  gallery: boolean;
  wiki: boolean;
  tools: boolean;
  equipmentCalc: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  announcements: true,
  events: true,
  guildWar: true,
  gallery: true,
  wiki: true,
  tools: true,
  equipmentCalc: true,
};
