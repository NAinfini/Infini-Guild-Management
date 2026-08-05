import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const localeModules = import.meta.glob<Record<string, unknown>>("./*/*.json");
const SUPPORTED_LOCALES = ["en", "zh"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
const loadedLocales = new Set<SupportedLocale>();
const localeLoads = new Map<SupportedLocale, Promise<void>>();

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

async function ensureLocaleResources(locale: SupportedLocale): Promise<void> {
  if (loadedLocales.has(locale)) return;
  const inFlight = localeLoads.get(locale);
  if (inFlight) return inFlight;

  const load = loadLocaleResources(locale).then((resources) => {
    for (const [namespace, bundle] of Object.entries(resources)) {
      i18n.addResourceBundle(locale, namespace, bundle, true, true);
    }
    loadedLocales.add(locale);
    localeLoads.delete(locale);
  });
  localeLoads.set(locale, load);
  return load;
}

function applyDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
}

async function initI18n(): Promise<void> {
  let storedLocale: string | null = null;
  try {
    storedLocale = typeof window === "undefined" ? null : window.localStorage.getItem("locale");
  } catch {
    storedLocale = null;
  }
  const locale = storedLocale === "en" || storedLocale === "zh"
    ? storedLocale
    : typeof navigator !== "undefined" && navigator.language.startsWith("zh") ? "zh" : "en";
  const resources = await loadLocaleResources(locale);
  const namespaces = Object.keys(resources);

  // HMR and isolated tests can reuse i18next's singleton. Clear loaded bundles so
  // bootstrap retains the same one-locale loading contract as a fresh page.
  const existingResources = (i18n.services?.resourceStore as unknown as {
    data?: Record<string, Record<string, unknown>>;
  } | undefined)?.data;
  for (const lang of SUPPORTED_LOCALES) {
    for (const namespace of Object.keys(existingResources?.[lang] ?? {})) {
      i18n.removeResourceBundle(lang, namespace);
    }
  }

  await i18n.use(initReactI18next).init({
    lng: locale,
    fallbackLng: false,
    defaultNS: "common",
    ns: namespaces,
    resources: { [locale]: resources },
    interpolation: { escapeValue: false },
  });
  loadedLocales.clear();
  loadedLocales.add(locale);
  applyDocumentLocale(locale);
}

export async function setI18nLocale(locale: SupportedLocale): Promise<void> {
  await ensureLocaleResources(locale);
  await i18n.changeLanguage(locale);
  applyDocumentLocale(locale);
}

export const i18nReady = initI18n();

export default i18n;
