import { createRoot } from "react-dom/client";
import { config as configureZod } from "zod";
import { applySplashLocale, applySplashTheme, dismissSplash } from "./splash";
import { DARK_MODE_MEDIA_QUERY, REDUCED_MOTION_MEDIA_QUERY, resolveThemeMode, usePreferencesStore } from "./stores/preferences";
import "./styles.css";

configureZod({ jitless: true });

// The entry bundle must own this copy: a locale chunk can be the failed resource.
const bootstrapErrorCopy = {
  en: {
    title: "Unable to load the portal",
    description: "Check your connection and try again. If the problem continues, try again later.",
    retry: "Retry",
  },
  zh: {
    title: "无法加载网站",
    description: "请检查网络连接后重试。如果问题持续，请稍后再试。",
    retry: "重试",
  },
};

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootElement);
const initialPreferences = usePreferencesStore.getState();
const initialThemeMode = resolveThemeMode(initialPreferences.themeMode, window.matchMedia(DARK_MODE_MEDIA_QUERY).matches);

applySplashTheme(initialThemeMode);
applySplashLocale(initialPreferences.locale);
document.documentElement.dataset.motion = initialPreferences.motionPreference === "reduce"
  || window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches ? "reduced" : "full";

void import("./bootstrap")
  .then(({ mountApp }) => {
    return mountApp(root);
  })
  .catch((error) => {
    console.error("Failed to bootstrap portal app", error);
    const { locale } = usePreferencesStore.getState();
    const copy = bootstrapErrorCopy[locale];
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.documentElement.dataset.theme ||= "dark";
    dismissSplash();
    root.render(
      <div role="alert" className="main-bootstrap-error">
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
          <button type="button" onClick={() => window.location.reload()}>{copy.retry}</button>
        </div>
      </div>,
    );
  });
