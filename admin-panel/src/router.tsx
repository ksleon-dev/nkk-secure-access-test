import { createBrowserRouter, useRouteError } from "react-router"
import { AppShell } from "@/components/layout/app-shell"
import { DashboardPage } from "@/features/dashboard/dashboard-page"
import { DevicesPage } from "@/features/devices/devices-page"
import { StatusPage } from "@/features/status/status-page"
import { PeersPage } from "@/features/peers/peers-page"
import { KeysPage } from "@/features/keys/keys-page"
import { NetworkPage } from "@/features/network/network-page"
import { NewsPage } from "@/features/news/news-page"
import { ReleasesPage } from "@/features/releases/releases-page"
import { SystemPage } from "@/features/system/system-page"

/**
 * Route-Fehlerkarte: faengt Render-/Loader-Fehler innerhalb des Routers ab, ohne
 * dass der ganze Baum abreisst. Deutsche Meldung plus 'Neu laden', damit die Seite
 * nie weiss bleibt.
 */
function RouteError() {
  const err = useRouteError()
  const msg = err instanceof Error ? err.message : String(err ?? "")
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border bg-card p-6">
        <h1 className="mb-2 text-lg font-semibold">Diese Ansicht konnte nicht geladen werden</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Ein unerwarteter Fehler ist aufgetreten. Bitte die Seite neu laden. Bleibt der Fehler
          bestehen, KronSolutions informieren.
        </p>
        {msg && (
          <p className="mb-4 break-words font-mono text-xs text-muted-foreground/70">{msg}</p>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border px-3.5 py-2 text-sm font-medium hover:bg-accent"
        >
          Neu laden
        </button>
      </div>
    </div>
  )
}

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppShell />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: "status", element: <StatusPage /> },
        { path: "devices", element: <DevicesPage /> },
        { path: "peers", element: <PeersPage /> },
        { path: "keys", element: <KeysPage /> },
        { path: "network", element: <NetworkPage /> },
        { path: "news", element: <NewsPage /> },
        { path: "releases", element: <ReleasesPage /> },
        { path: "system", element: <SystemPage /> },
        { path: "*", element: <DashboardPage /> },
      ],
    },
  ],
  { basename: "/" },
)
