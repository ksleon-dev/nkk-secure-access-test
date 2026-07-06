import { useNavigate } from "react-router"
import { useData } from "@/lib/data-context"
import { computeAlerts } from "@/lib/alerts"
import { versionKind } from "@/lib/format"
import { PageHeader, SevBadge, ErrorState } from "@/components/common/bits"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CheckCircle2, ChevronRight } from "lucide-react"

export function DashboardPage() {
  const { data, loading, error, refresh } = useData()
  const navigate = useNavigate()

  if (error && !data) return <ErrorState message={error} onRetry={refresh} />
  if (loading && !data) return <DashboardSkeleton />
  if (!data) return null

  const alerts = computeAlerts(data)
  const cur = data.current_version
  const online = data.peers.filter((p) => p.connected).length
  const validKeys = data.keys.filter((k) => k.valid).length
  // Gleiche Logik wie die RolloutCard: Geraete ohne Meldung zaehlen NICHT als veraltet.
  const norm = (v?: string | null) => (v && v !== "None" ? v : null)
  const current = data.devices.filter((d) => norm(d.app_version) === cur).length
  const unknown = data.devices.filter((d) => !norm(d.app_version)).length
  const outdated = data.devices.length - current - unknown

  const kpis = [
    { n: data.devices.length, l: "Geräte" },
    { n: `${online} / ${data.peers.length}`, l: "Peers online" },
    { n: outdated, l: "veraltete Version", alert: outdated > 0 },
    { n: current, l: `aktuell (${cur})` },
    { n: validKeys, l: "gültige Keys" },
  ]

  // Versions-Verteilung
  const vc = new Map<string, number>()
  for (const d of data.devices) {
    const v = d.app_version || "unbekannt"
    vc.set(v, (vc.get(v) || 0) + 1)
  }
  const versions = [...vc.entries()].sort((a, b) => b[1] - a[1])
  // Nenner ist die Flotten-Gesamtzahl, damit die Balken den echten Anteil zeigen
  // (nicht relativ zur groessten Gruppe). min-7%-Floor haelt Kleinstgruppen sichtbar.
  const totalV = Math.max(data.devices.length, 1)

  return (
    <div>
      <PageHeader title="Übersicht" description="Was gerade Aufmerksamkeit braucht, mit einem Klick erledigt." />

      {/* Action Center */}
      <section className="mb-7">
        <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">Aufgaben</h2>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-4">
            <CheckCircle2 className="size-5 text-ok" />
            <div className="text-sm">
              <span className="font-medium">Alles im grünen Bereich.</span>{" "}
              <span className="text-muted-foreground">Keine offenen Punkte.</span>
            </div>
          </div>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={
                    "mt-0.5 size-2 shrink-0 rounded-full " +
                    (a.severity === "high" ? "bg-destructive" : a.severity === "warn" ? "bg-warn" : "bg-muted-foreground/40")
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{a.title}</span>
                    <SevBadge severity={a.severity} />
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{a.detail}</p>
                </div>
                {a.actionTo && (
                  <Button variant="ghost" size="sm" className="shrink-0" onClick={() => navigate(a.actionTo!)}>
                    {a.actionLabel}
                    <ChevronRight className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* KPIs */}
      <section className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k, i) => (
          <div key={i} className="rounded-xl border bg-card p-5">
            <div className={"text-[28px] font-semibold leading-none tabular-nums " + (k.alert ? "text-destructive" : "")}>{k.n}</div>
            <div className="mt-2 text-[13px] font-medium text-muted-foreground">{k.l}</div>
          </div>
        ))}
      </section>

      {/* Versions-Verteilung */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">App-Versionen im Feld</h2>
        <div className="space-y-2.5">
          {versions.map(([v, c]) => {
            const kind = versionKind(v === "unbekannt" ? null : v, cur)
            const color =
              kind === "current" ? "bg-ok" : kind === "older" ? "bg-primary" : kind === "old" ? "bg-chart-2" : "bg-muted-foreground/40"
            return (
              <div key={v} className="flex items-center gap-3">
                <div className="w-28 shrink-0 font-mono text-[13px] tabular-nums">
                  {v}
                  {kind === "current" && " ✓"}
                </div>
                <div className="h-5 flex-1 overflow-hidden rounded bg-secondary">
                  <div className={"flex h-full items-center rounded px-2 text-[11px] font-semibold text-white " + color} style={{ width: `${Math.max(7, (c / totalV) * 100)}%` }}>
                    {c}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-ok" />aktuell</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />veraltet</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-chart-2" />leicht veraltet</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/40" />keine Meldung</span>
        </div>
      </section>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div>
      <Skeleton className="mb-6 h-8 w-48" />
      <Skeleton className="mb-7 h-32 w-full rounded-xl" />
      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}
