import { getGuildWarResultColor } from "./game-rules";

export function resolveResultTagColor(result: string | null | undefined): string {
  return getGuildWarResultColor(result);
}
