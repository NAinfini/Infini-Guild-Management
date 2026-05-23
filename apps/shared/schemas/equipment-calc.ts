import { z } from "zod";

export const statEntrySchema = z.object({
  type: z.string().min(1),
  value: z.number(),
});

export const equipmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  slotId: z.string().min(1),
  slotName: z.string().optional(),
  weaponTypeId: z.string().optional(),
  isChengyin: z.boolean(),
  isPurple: z.boolean(),
  mainStat: statEntrySchema,
  subStats: z.array(statEntrySchema).max(4),
  dingyinStat: statEntrySchema,
  availableClasses: z.array(z.string()).optional(),
  createdAt: z.number(),
});

const loanDingyinStatsSchema = z.object({
  outerPenetration: z.number(),
  elePenetration: z.number(),
  specificSkillBonus: z.number(),
});

export const loadoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  classId: z.string().min(1),
  xinfaSlots: z.array(z.string()).length(4),
  setId: z.string().min(1),
  bowType: z.string().min(1),
  armoryType: z.string().min(1),
  equippedItems: z.object({
    weapon1: z.string().optional(),
    weapon2: z.string().optional(),
    head: z.string().optional(),
    chest: z.string().optional(),
    ring: z.string().optional(),
    pendant: z.string().optional(),
    legs: z.string().optional(),
    hands: z.string().optional(),
  }),
  earlySeasonBonus: z.boolean(),
  loanDingyin: z.boolean(),
  loanDingyinStats: loanDingyinStatsSchema,
});

const rotationEntrySchema = z.object({
  name: z.string().min(1),
  count: z.number(),
  isDingyin: z.boolean(),
  generalBonus: z.number(),
  included: z.boolean(),
  yishui: z.number(),
  tiaozhan: z.number().default(1),
  chunlei: z.union([z.boolean(), z.string()]).transform((value) => (
    typeof value === "string" ? value.trim().length > 0 : value
  )).optional(),
});

const skillEntrySchema = z.object({
  modifiers: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
  outerRatio: z.number().default(0),
  fixed: z.number().default(0),
  eleRatio: z.number().default(0),
  exMinATK: z.number().default(0),
  exMaxATK: z.number().default(0),
  exATK: z.number().default(0),
  exCrit: z.number().default(0),
  exCritDmg: z.number().default(0),
  exIntent: z.number().default(0),
  exIntentDmg: z.number().default(0),
  exDmg: z.number().default(0),
  exPen: z.number().default(0),
  isCharge: z.number().default(0),
  type: z.string(),
  weaponType: z.string(),
  element: z.string(),
  special: z.string(),
  force: z.string(),
});

const classRotationConfigSchema = z.object({
  rotation: z.array(rotationEntrySchema).min(1, "At least one rotation entry is required"),
  skillDatabase: z.record(z.string(), skillEntrySchema).refine(
    (skills) => Object.keys(skills).length > 0,
    "At least one skill entry is required",
  ),
  baseline: z.number(),
  baseline2: z.number(),
  useTime: z.number(),
  author: z.string(),
  version: z.string(),
  updateTime: z.string(),
});

const xinfaRulesSchema = z.object({
  default: z.array(z.string()),
  extra: z.array(z.string()),
});

const slotDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().min(1),
  icon: z.string().optional(),
});

const weaponTypeDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().min(1),
  icon: z.string().optional(),
  stat: z.string().min(1),
});

export const gameDataSchema = z.object({
  version: z.string().min(1),
  updatedAt: z.string().min(1),
  schemaVersion: z.number().int().min(1),
  seasonStats: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.record(z.string(), z.number())])),
  maxValues: z.record(z.string(), z.number()),
  xinfaData: z.record(z.string(), z.record(z.string(), z.number())),
  setData: z.record(z.string(), z.record(z.string(), z.number())),
  classes: z.array(z.string()).min(1),
  weaponRules: z.record(z.string(), z.array(z.string())),
  defaultSets: z.record(z.string(), z.string()),
  xinfaRules: z.record(z.string(), xinfaRulesSchema),
  xinfaLocked: z.record(z.string(), z.array(z.string())),
  xinfaList: z.array(z.string()),
  genericXinfa: z.array(z.string()),
  rotations: z.record(z.string(), classRotationConfigSchema),
  slots: z.array(slotDefSchema).min(1),
  weaponTypes: z.array(weaponTypeDefSchema).min(1),
  slotRules: z.object({
    mainStats: z.record(z.string(), z.array(z.string())),
    dingyinStats: z.record(z.string(), z.array(z.string())),
  }),
  baseStats: z.record(z.string(), z.number()),
  percentStats: z.array(z.string()),
  baseSubStats: z.array(z.string()),
  transmutationPools: z.record(z.string(), z.array(z.string())).optional(),
});

export type EquipmentInput = z.infer<typeof equipmentSchema>;
export type LoadoutInput = z.infer<typeof loadoutSchema>;
export type GameDataInput = z.infer<typeof gameDataSchema>;
