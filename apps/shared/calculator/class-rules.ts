import type { ClassRotationConfig } from "./types";

export function isHealingClass(classId: string, xinfaLoadout: string[]): boolean {
  return classId === "牵丝霖" && !xinfaLoadout.includes("怒斩马");
}

export function getBaselineByClass(
  classId: string,
  xinfaLoadout: string[],
  config: ClassRotationConfig,
  healing: boolean,
): number {
  let baseline = config.baseline;
  if (healing) {
    baseline = config.baseline2;
  } else if (
    classId === "破竹尘" &&
    (xinfaLoadout.includes("断石之构") ||
      xinfaLoadout.includes("大唐歌") ||
      xinfaLoadout.includes("征人归") ||
      xinfaLoadout.includes("明晦同尘"))
  ) {
    baseline = config.baseline2;
  }
  return baseline;
}
