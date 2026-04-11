import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Disable the native context menu (right-click "Copy / Inspect / ..." etc.)
// except inside inputs where we need the standard paste menu.
if (typeof window !== "undefined") {
  window.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }
    e.preventDefault();
  });
  window.addEventListener("dragstart", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "IMG" || target.tagName === "SVG")) {
      e.preventDefault();
    }
  });
}

// No React.StrictMode — it double-fires useEffect in dev mode which causes
// two macOS Keychain prompts on startup (both read the same keyring entry
// before the first result is cached). StrictMode serves no purpose in a
// production Tauri app.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
