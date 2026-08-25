import { createRoot } from "react-dom/client";
import { config as configureZod } from "zod";
import { applySplashVisualTheme, dismissSplash } from "./splash";
import "./styles.css";

configureZod({ jitless: true });

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootElement);

void Promise.all([
  import("./visual/themes").then(({ ACTIVE_VISUAL_THEME }) => {
    applySplashVisualTheme(ACTIVE_VISUAL_THEME);
  }),
  import("./bootstrap"),
])
  .then(([, { mountApp }]) => {
    return mountApp(root);
  })
  .catch((error) => {
    console.error("Failed to bootstrap portal app", error);
    document.documentElement.dataset.theme ||= "dark";
    dismissSplash();
    root.render(
      <div role="alert" className="main-bootstrap-error">
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Portal failed to load</h1>
          <p style={{ marginTop: 8, marginBottom: 0 }}>Open console for details.</p>
        </div>
      </div>,
    );
  });
