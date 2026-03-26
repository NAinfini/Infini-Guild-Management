export type LocaleOption = {
  value: "en" | "zh";
  label: string;
  description: string;
};

type Translate = (key: string) => string;

const LOCALE_DEFINITIONS = [
  {
    value: "en" as const,
    labelKey: "locale.option.en",
    descriptionKey: "locale.option.en.description",
  },
  {
    value: "zh" as const,
    labelKey: "locale.option.zh",
    descriptionKey: "locale.option.zh.description",
  },
] as const;

export function buildLocaleOptions(translate: Translate): LocaleOption[] {
  return LOCALE_DEFINITIONS.map(({ value, labelKey, descriptionKey }) => ({
    value,
    label: translate(labelKey),
    description: translate(descriptionKey),
  }));
}
