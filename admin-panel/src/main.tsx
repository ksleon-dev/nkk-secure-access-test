import { Component, StrictMode, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router"
import "./index.css"
import { AuthGate } from "@/features/auth/AuthGate"
import { DataProvider } from "@/lib/data-context"
import { router } from "@/router"
import { Toaster } from "@/components/ui/sonner"

/**
 * Letzte Absicherung gegen eine weisse Seite: faengt jede unerwartete
 * Render-Exception im Baum ab (unerwartetes Datenfeld, null-Objekt, Fehler in
 * computeAlerts/parseChangelog usw.) und zeigt statt des abgerissenen Baums eine
 * deutsche Fehlerkarte mit 'Neu laden'. Kopf, Meldung und Reload bleiben sichtbar.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Fuer Diagnose in der Browser-Konsole belassen.
    console.error("Panel-Renderfehler:", error)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: "32rem",
              width: "100%",
              border: "1px solid rgba(127,127,127,0.3)",
              borderRadius: "0.75rem",
              padding: "1.5rem",
              background: "rgba(127,127,127,0.05)",
            }}
          >
            <h1 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Etwas ist schiefgelaufen
            </h1>
            <p style={{ fontSize: "0.9rem", opacity: 0.8, marginBottom: "1rem" }}>
              Die Ansicht konnte nicht dargestellt werden. Bitte die Seite neu laden. Bleibt der
              Fehler bestehen, KronSolutions informieren.
            </p>
            <p
              style={{
                fontSize: "0.75rem",
                opacity: 0.6,
                marginBottom: "1rem",
                fontFamily: "ui-monospace, monospace",
                wordBreak: "break-word",
              }}
            >
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: "1px solid rgba(127,127,127,0.4)",
                borderRadius: "0.5rem",
                padding: "0.45rem 0.9rem",
                fontSize: "0.85rem",
                fontWeight: 500,
                cursor: "pointer",
                background: "transparent",
              }}
            >
              Neu laden
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthGate>
        {(onUnauthorized) => (
          <DataProvider onUnauthorized={onUnauthorized}>
            <RouterProvider router={router} />
          </DataProvider>
        )}
      </AuthGate>
      <Toaster position="bottom-center" richColors />
    </ErrorBoundary>
  </StrictMode>,
)
