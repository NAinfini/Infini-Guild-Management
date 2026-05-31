import { createRoot } from "react-dom/client";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootElement);

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
