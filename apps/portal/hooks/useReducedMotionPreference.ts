import { REDUCED_MOTION_MEDIA_QUERY, usePreferencesStore } from "../stores/preferences";
import { useMediaQuery } from "./useMediaQuery";

export function useReducedMotionPreference(): boolean {
  const motionPreference = usePreferencesStore((state) => state.motionPreference);
  const systemReducedMotion = useMediaQuery(REDUCED_MOTION_MEDIA_QUERY);
  return motionPreference === "reduce" || systemReducedMotion;
}
