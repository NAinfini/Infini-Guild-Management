import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

const localeModules = import.meta.glob<Record<string, unknown>>("./*/*.json");
const SUPPORTED_LOCALES = ["en", "zh"] as const;

async function loadLocaleResources(lang: string): Promise<Record<string, object>> {
  const resources: Record<string, object> = {};
  const entries = Object.entries(localeModules).filter(([path]) => path.startsWith(`./${lang}/`));
  const modules = await Promise.all(entries.map(async ([path, loader]) => {
    const match = path.match(/^\.\/[^/]+\/([^/]+)\.json$/);
    if (!match) return null;
    const ns = match[1]!;
    const mod = await loader();
    return [ns, (mod.default ?? mod) as object] as const;
  }));
  for (const entry of modules) {
    if (entry) resources[entry[0]] = entry[1];
  }
  return resources;
}

async function initI18n(): Promise<void> {
  const storedLocale = localStorage.getItem("locale");
  const locale = storedLocale === "en" || storedLocale === "zh"
    ? storedLocale
    : navigator.language.startsWith("zh") ? "zh" : "en";
  const fallbackLng = "en";

  const localeEntries = await Promise.all(
    SUPPORTED_LOCALES.map(async (lang) => [lang, await loadLocaleResources(lang)] as const),
  );
  const resources = Object.fromEntries(localeEntries) as Resource;
  const namespaces = [...new Set(localeEntries.flatMap(([, entries]) => Object.keys(entries)))];

  await i18n.use(initReactI18next).init({
    lng: locale,
    fallbackLng,
    defaultNS: "common",
    ns: namespaces,
    resources,
    interpolation: { escapeValue: false },
  });

  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
}

export const i18nReady = initI18n();

export default i18n;
