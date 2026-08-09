/*
 * 职业默认图标。这个数组的顺序就是图标库网格里的顺序，所以按「近战 → 远程 → 施法 →
 * 其它」摆，别按加进来的先后追加——同一类武器散在四处的话，挑图标得整片扫一遍。
 *
 * 新图标必须在 24px 下与现有选项有可辨识差异，避免重复占位。
 *
 * 只是加 id 的话不用动数据库：class_catalog.vector_icon 是裸 TEXT，取值范围由
 * apps/shared/schemas/class-catalog.ts 里的 zod enum 管。但每加一个都得配齐三样：
 * apps/portal/components/icons 下的组件、ClassIcon.tsx 里的映射、两份 admin.json
 * 里的 classes.icon.<id> 名字。漏了映射会在渲染时回退成长剑，漏了名字则回退成 id。
 *
 * 删 id 就不是加的逆操作了：ClassCatalogService 读表时会拿这个 enum 校验每一行
 * （classCatalogItemSchema.parse），库里还留着被删的 id 的话，整个职业列表接口会抛。
 * 所以删之前必须先把存量行改掉：
 *   UPDATE class_catalog SET vector_icon = 'sword' WHERE vector_icon NOT IN (...);
 */
export const CLASS_VECTOR_ICON_IDS = [
  // 近战
  "sword",
  "swords",
  "dagger",
  "axe",
  "spear",
  "trident",
  "scythe",
  "hammer",
  "claw",
  "gauntlet",
  "shield",
  // 远程、投掷
  "bow",
  "target",
  "target-arrow",
  "bomb",
  // 施法
  "staff",
  "wand",
  "orb",
  "gem",
  "sparkles",
  "flame",
  "bolt",
  "snowflake",
  "moon",
  "sun",
  // 辅助、治疗
  "heart",
  "heartbeat",
  "potion",
  "chalice",
  "leaf",
  // 学识、演艺
  "book",
  "scroll",
  "lute",
  // 身份、装束
  "crown",
  "trophy",
  "flag",
  "mask",
  "pendant",
  "rings",
  "boot",
  "skull",
  "dice",
] as const;

export type ClassVectorIconId = (typeof CLASS_VECTOR_ICON_IDS)[number];
