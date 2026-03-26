export const CLASS_NAMES = [
  "鸣金虹",
  "鸣金影",
  "牵丝玉",
  "牵丝霖",
  "破竹风",
  "破竹尘",
  "破竹鸢",
  "裂石威",
  "裂石钧",
] as const;

export type ClassName = (typeof CLASS_NAMES)[number];

export const CLASS_COLOR_GROUP = {
  "鸣金虹": "blue",
  "鸣金影": "blue",
  "牵丝玉": "green",
  "牵丝霖": "green",
  "破竹风": "purple",
  "破竹尘": "purple",
  "破竹鸢": "purple",
  "裂石威": "dark-red",
  "裂石钧": "dark-red",
} as const;

export type ClassColorGroup = (typeof CLASS_COLOR_GROUP)[ClassName];

export function getClassColorGroup(className: ClassName): ClassColorGroup {
  return CLASS_COLOR_GROUP[className];
}
