import { createRoot } from "react-dom/client";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "@infini-dev-kit/frontend/theme/mantine/mantine-residual.css";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootElement);

root.render(
  <div
    role="status"
    aria-live="polite"
    style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "var(--infini-color-bg, #f6f7fb)",
      color: "var(--infini-color-text, #111827)",
      padding: 24,
      fontFamily: "Inter, system-ui, sans-serif",
    }}
  >
    <div
      style={{
        width: "min(920px, 94vw)",
        borderRadius: 18,
        border: "1px solid color-mix(in srgb, #111827 18%, transparent)",
        background:
          "linear-gradient(135deg, color-mix(in srgb, #2563eb 16%, white), color-mix(in srgb, #111827 9%, white))",
        padding: "clamp(18px, 4vw, 34px)",
        boxShadow: "0 12px 28px rgba(2, 6, 23, 0.14)",
        textAlign: "left",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "clamp(2.4rem, 10vw, 6.2rem)",
          lineHeight: 0.92,
          fontWeight: 800,
          letterSpacing: "-0.03em",
        }}
      >
        Infini Guild
      </p>
      <p style={{ marginTop: 12, marginBottom: 0, opacity: 0.74, fontSize: "clamp(0.95rem, 2.2vw, 1.2rem)" }}>
        Loading workspace…
      </p>
    </div>
  </div>,
);

void import("./bootstrap")
  .then(({ mountApp }) => {
    mountApp(root);
  })
  .catch((error) => {
    console.error("Failed to bootstrap portal app", error);
    root.render(
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#fff7f7",
          color: "#7f1d1d",
          padding: 24,
          fontFamily: "Inter, system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Portal failed to load</h1>
          <p style={{ marginTop: 8, marginBottom: 0 }}>Open console for details.</p>
        </div>
      </div>,
    );
  });
