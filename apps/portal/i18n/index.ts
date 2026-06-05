import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

const localeModules = import.meta.glob<Record<string, unknown>>("./*/*.json");

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
  const locale = localStorage.getItem("locale") ?? (navigator.language.startsWith("zh") ? "zh" : "en");
  const fallbackLng = "en";

  const [localeResources, fallbackResources] = await Promise.all([
    loadLocaleResources(locale),
    locale !== fallbackLng ? loadLocaleResources(fallbackLng) : Promise.resolve({}),
  ]);

  const namespaces = Object.keys(localeResources);
  const resources: Resource = {
    [locale]: localeResources,
    ...(locale !== fallbackLng ? { [fallbackLng]: fallbackResources } : {}),
  };

  await i18n.use(initReactI18next).init({
    lng: locale,
    fallbackLng,
    defaultNS: "common",
    ns: namespaces,
    resources,
    interpolation: { escapeValue: false },
  });
}

export const i18nReady = initI18n();

export default i18n;
