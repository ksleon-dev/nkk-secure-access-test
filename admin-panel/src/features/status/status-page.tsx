import type { ComponentType } from "react"
import { useData } from "@/lib/data-context"
import { PageHeader, ErrorState } from "@/components/common/bits"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { CheckCircle2, AlertTriangle, Server, Printer, HelpCircle } from "lucide-react"
import type { StatusTarget } from "@/lib/types"

const TYPE_META: Record<string, { label: string; icon: ComponentType<{ className?: string }> }> = {
  server: { label: "Server", icon: Server },
  printer: { label: "Drucker", icon: Printer },
  other: { label: "Sonstiges", icon: HelpCircle },
}

function Dot({ online }: { online: boolean | null }) {
  return (
    <span
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        online === true ? "bg-ok" : online === false ? "bg-destructive" : "bg-muted-foreground/40",
      )}
    />
  )
}

export function StatusPage() {
  const { data, loading, error, refresh } = useData()
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />
  if (loading && !data)
    return (
      <div>
        <PageHeader title="Status" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  if (!data) return null

  const peers = data.peers ?? []
  const targets = data.status_targets ?? []
  const peersOn = peers.filter((p) => p.connected).length
  const tOnline = targets.filter((t) => t.online === true).length
  const tOffline = targets.filter((t) => t.online === false).length
  const noTargets = targets.length === 0
  const allGood = !noTargets && tOffline === 0

  const byType: Record<string, StatusTarget[]> = {}
  for (const t of targets) {
    const k = TYPE_META[t.type] ? t.type : "other"
    if (!byType[k]) byType[k] = []
    byType[k].push(t)
  }

  return (
    <div>
      <PageHeader
        title="Status"
        description="Erreichbarkeit von Infrastruktur und VPN-Geräten: von Drucker bis Server bis Client."
      />

      <div
        className={cn(
          "mb-5 flex items-center gap-4 rounded-xl border border-l-4 p-5",
          noTargets
            ? "border-l-muted-foreground/30 bg-muted/30"
            : allGood
              ? "border-l-ok bg-ok/5"
              : "border-l-destructive bg-destructive/5",
        )}
      >
        {noTargets ? (
          <HelpCircle className="size-8 shrink-0 text-muted-foreground" />
        ) : allGood ? (
          <CheckCircle2 className="size-8 shrink-0 text-ok" />
        ) : (
          <AlertTriangle className="size-8 shrink-0 text-destructive" />
        )}
        <div className="min-w-0">
          <div className="text-lg font-semibold">
            {noTargets
              ? "Keine Infrastruktur-Ziele konfiguriert"
              : allGood
                ? "Alles erreichbar"
                : `${tOffline} Infrastruktur-Ziel${tOffline === 1 ? "" : "e"} offline`}
          </div>
          <div className="text-sm text-muted-foreground tabular-nums">
            Infrastruktur {tOnline}/{targets.length} erreichbar · VPN-Geräte {peersOn}/{peers.length} verbunden
          </div>
        </div>
      </div>

      <h2 className="mb-2 text-[15px] font-semibold">Infrastruktur</h2>
      {targets.length === 0 ? (
        <div className="mb-6 rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          Noch keine Server/Drucker hinterlegt. Eintragen in{" "}
          <span className="font-mono">/etc/nkk-admin/status-targets.json</span> (Name, IP, Typ). Der Server pingt sie
          dann hier alle 60 s.
        </div>
      ) : (
        <div className="mb-6 space-y-4">
          {Object.entries(byType).map(([type, list]) => {
            const M = TYPE_META[type] ?? TYPE_META.other
            return (
              <div key={type} className="overflow-hidden rounded-xl border bg-card">
                <div className="flex items-center gap-2 border-b px-4 py-2.5 text-[13px] font-medium text-muted-foreground">
                  <M.icon className="size-4" /> {M.label}
                </div>
                <div className="divide-y">
                  {list.map((t) => (
                    <div key={t.host} className="flex items-center gap-3 px-4 py-2.5">
                      <Dot online={t.online} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{t.name}</div>
                        <div className="truncate font-mono text-[12.5px] text-muted-foreground">{t.host}</div>
                      </div>
                      <div className="text-[13px] tabular-nums text-muted-foreground">
                        {t.online === true
                          ? t.ms != null
                            ? `${Math.round(t.ms)} ms`
                            : "erreichbar"
                          : t.online === false
                            ? "offline"
                            : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <h2 className="mb-2 text-[15px] font-semibold">
        VPN-Geräte <span className="font-normal text-muted-foreground tabular-nums">({peersOn}/{peers.length} verbunden)</span>
      </h2>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="divide-y">
          {peers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <Dot online={p.connected} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate font-mono text-[12.5px] text-muted-foreground">{p.ip ?? "—"}</div>
              </div>
              <div className="text-[13px] tabular-nums text-muted-foreground">
                {p.connected ? "verbunden" : "offline"}
                {p.version ? ` · ${p.version}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
