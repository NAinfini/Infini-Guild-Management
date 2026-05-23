import type { TFunction } from "i18next";

export function formatClassLabel(classId: string, t?: TFunction): string {
  if (t) {
    const translated = t(`classNames.${classId}`, { defaultValue: "" });
    if (translated) return translated;
  }
  return classId;
}

export function getUniqueClassOptions(classes: string[], preferredValues: string[] = [], t?: TFunction) {
  const preferred = new Set(preferredValues);
  const options = new Map<string, { label: string; value: string }>();

  for (const classId of classes) {
    const label = formatClassLabel(classId, t);
    const current = options.get(label);
    if (!current || preferred.has(classId)) {
      options.set(label, { label, value: classId });
    }
  }

  return Array.from(options.values());
}
