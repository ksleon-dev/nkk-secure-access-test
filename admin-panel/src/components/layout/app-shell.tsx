import { useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router"
import { NAV } from "@/config/nav"
import { useData } from "@/lib/data-context"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useVersionWatch } from "@/lib/use-version-watch"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { GlobalSearch } from "@/components/global-search"
import { ShieldCheck, RefreshCw, LogOut, Menu, ExternalLink, AlertTriangle } from "lucide-react"

const NETBIRD_MGMT_URL = "https://vpn.secure.nkk-hb.de"

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
        <ShieldCheck className="size-5" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">NKK Secure Access</div>
        <div className="text-xs text-muted-foreground">Admin Console</div>
      </div>
    </div>
  )
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors",
              isActive
                ? "bg-accent text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )
          }
        >
          <item.icon className="size-5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

function LogoutButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
    >
      <LogOut className="size-5" />
      Abmelden
    </button>
  )
}

export function AppShell() {
  const { data, error, refresh, loading, lastUpdated, onUnauthorized } = useData()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  useVersionWatch() // bei neuer Panel-Version automatisch neu laden (kein Stale-Cache)

  // Stale-Banner: nur wenn eine Aktualisierung fehlschlug, aber noch alte Daten da sind.
  const stale = !!error && !!data

  async function logout() {
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
    onUnauthorized()
  }

  return (
    <div className="flex min-h-svh bg-background">
      {/* Desktop-Sidebar */}
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-16 items-center px-4">
          <Brand />
        </div>
        <div className="px-3 py-2">
          <NavLinks />
        </div>
        <div className="mt-auto p-3">
          <LogoutButton onClick={logout} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-7">
          {/* Mobile-Navigation */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Navigation öffnen">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="h-16 flex-row items-center border-b px-4">
                <Brand />
                <SheetTitle className="sr-only">Navigation</SheetTitle>
              </SheetHeader>
              <div className="px-3 py-2">
                <NavLinks onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="p-3">
                <LogoutButton onClick={() => { setMobileOpen(false); logout() }} />
              </div>
            </SheetContent>
          </Sheet>

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-3">
            {lastUpdated && (
              <span className="hidden text-[13px] text-muted-foreground tabular-nums sm:inline">
                Stand {lastUpdated.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Button asChild variant="outline" size="sm">
              <a href={NETBIRD_MGMT_URL} target="_blank" rel="noopener noreferrer" title="NetBird-Verwaltung öffnen">
                <ExternalLink className="size-3.5" />
                <span className="hidden sm:inline">NetBird-Verwaltung</span>
                <span className="sm:hidden">NetBird</span>
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              Aktualisieren
            </Button>
          </div>
        </header>

        {stale && (
          <div className="flex h-9 items-center gap-2 border-b border-warn/25 bg-warn/10 px-4 text-[13px] text-warn md:px-7">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              Aktualisierung fehlgeschlagen, Anzeige ist veraltet
              {lastUpdated && ` (Stand ${lastUpdated.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })})`}.
            </span>
            <button
              onClick={refresh}
              disabled={loading}
              className="ml-auto shrink-0 font-medium underline underline-offset-2 disabled:opacity-50"
            >
              Erneut versuchen
            </button>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-8 md:px-7 lg:px-10">
          <div
            key={location.pathname}
            className="mx-auto max-w-7xl duration-300 ease-out animate-in fade-in-50 slide-in-from-bottom-1"
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
