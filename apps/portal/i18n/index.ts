import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

const localeModules = import.meta.glob<Record<string, unknown>>("./*/*.json", { eager: true });

function buildResources(): { resources: Resource; namespaces: string[] } {
  const resources: Record<string, Record<string, object>> = {};
  const namespaceSet = new Set<string>();

  for (const [path, module] of Object.entries(localeModules)) {
    const match = path.match(/^\.\/([^/]+)\/([^/]+)\.json$/);
    if (!match) continue;
    const [, lang, file] = match;
    const ns = file!;
    namespaceSet.add(ns);
    if (!resources[lang!]) resources[lang!] = {};
    resources[lang!][ns] = (module.default ?? module) as object;
  }

  return { resources: resources as Resource, namespaces: [...namespaceSet] };
}

const { resources, namespaces } = buildResources();

const locale = localStorage.getItem("locale") ?? (navigator.language.startsWith("zh") ? "zh" : "en");

void i18n.use(initReactI18next).init({
  lng: locale,
  fallbackLng: "en",
  defaultNS: "common",
  ns: namespaces,
  resources,
  interpolation: { escapeValue: false },
});

export default i18n;
