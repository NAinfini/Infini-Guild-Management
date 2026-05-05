import { activeGame } from "../games";

export const CLASS_NAMES = activeGame.classes.map((c) => c.id) as unknown as readonly [string, ...string[]];

export type ClassName = (typeof CLASS_NAMES)[number];

export const CLASS_COLOR_GROUP: Record<string, string> = Object.fromEntries(
  activeGame.classes.map((c) => [c.id, c.colorGroup]),
);
