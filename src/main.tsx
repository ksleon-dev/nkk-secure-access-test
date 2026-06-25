import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Global safety nets for a 24/7 run. The native right-click menu is handled in
// one place only - ContextMenuProvider - which also allows text fields and
// .allow-select regions (so diagnostics stay copyable); no duplicate here.
if (typeof window !== "undefined") {
  // Last-resort visibility for otherwise-silent failures during a 24/7 run.
  window.addEventListener("unhandledrejection", (e) => {
    console.error("Unhandled promise rejection:", e.reason);
  });
  window.addEventListener("error", (e) => {
    console.error("Uncaught error:", e.error ?? e.message);
  });
  window.addEventListener("dragstart", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "IMG" || target.tagName === "SVG")) {
      e.preventDefault();
    }
  });
}

// No React.StrictMode - it double-fires useEffect in dev mode which causes
// two macOS Keychain prompts on startup (both read the same keyring entry
// before the first result is cached). StrictMode serves no purpose in a
// production Tauri app.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
