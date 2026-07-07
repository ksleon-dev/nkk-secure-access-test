import { useEffect, useMemo, useState } from "react"
import { Search, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react"
import { api, AuthError } from "@/lib/api"
import { useData } from "@/lib/data-context"
import type { ActivityItem } from "@/lib/types"
import { relativeTime } from "@/lib/format"
import { PageHeader, EmptyState, ErrorState } from "@/components/common/bits"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

// Aktion -> Anzeige. "rdp/smb/ssh" sind die von der App gemeldeten Typen.
const KIND_LABEL: Record<string, string> = {
  rdp: "RDP",
  smb: "Dateiablage",
  ssh: "SSH",
  url: "Web",
  connect: "Verbunden",
  disconnect: "Getrennt",
}
const KIND_CLS: Record<string, string> = {
  rdp: "bg-primary/10 text-primary",
  smb: "bg-accent/20 text-foreground",
  ssh: "bg-muted text-muted-foreground",
  url: "bg-muted text-muted-foreground",
  connect: "bg-ok/10 text-ok",
  disconnect: "bg-muted text-muted-foreground",
}
const ROLE_LABEL: Record<string, string> = {
  user: "Standard",
  manager: "Geschäftsführung",
  it_admin: "Administrator",
  infact: "InFact",
}

function kindLabel(k?: string) {
  return (k && KIND_LABEL[k]) || k || "—"
}
function roleLabel(r?: string) {
  return (r && ROLE_LABEL[r]) || r || "—"
}

export function AktivitaetPage() {
  const { onUnauthorized } = useData()
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [q, setQ] = useState("")
  const [kind, setKind] = useState<string>("all")
  const [role, setRole] = useState<string>("all")

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .activity(1000)
      .then((r) => {
        if (!alive) return
        setItems(r.items ?? [])
        setError(null)
      })
      .catch((e) => {
        if (e instanceof AuthError) {
          onUnauthorized()
          return
        }
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [onUnauthorized, reloadKey])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((it) => {
      if (kind !== "all" && it.kind !== kind) return false
      if (role !== "all" && it.role !== role) return false
      if (!needle) return true
      return [it.device, it.hostname, it.os_user, it.label, it.target]
        .some((x) => String(x ?? "").toLowerCase().includes(needle))
    })
  }, [items, q, kind, role])

  // Welche Aktions-/Rollentypen kommen ueberhaupt vor (fuer die Filter-Auswahl).
  const kindsPresent = useMemo(
    () => Array.from(new Set(items.map((i) => i.kind).filter(Boolean))) as string[],
    [items],
  )
  const rolesPresent = useMemo(
    () => Array.from(new Set(items.map((i) => i.role).filter(Boolean))) as string[],
    [items],
  )

  if (error && items.length === 0) {
    return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
  }

  return (
    <div>
      <PageHeader
        title="Aktivität"
        description={items.length ? `${items.length} Zugriffe protokolliert` : undefined}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Gerät, Benutzer, Ziel …"
                className="h-10 w-64 pl-9"
              />
            </div>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-10 w-40"><SelectValue placeholder="Aktion" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Aktionen</SelectItem>
                {kindsPresent.map((k) => (
                  <SelectItem key={k} value={k}>{kindLabel(k)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-10 w-44"><SelectValue placeholder="Rolle" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Rollen</SelectItem>
                {rolesPresent.map((r) => (
                  <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              Aktualisieren
            </button>
          </>
        }
      />

      {loading && items.length === 0 ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Keine Einträge"
          hint="Noch keine protokollierte Aktivität, oder der Filter passt auf nichts."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="nkk-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Zeit</TableHead>
                <TableHead>Gerät</TableHead>
                <TableHead>Benutzer</TableHead>
                <TableHead>Rolle</TableHead>
                <TableHead>Aktion</TableHead>
                <TableHead>Ziel</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((it, i) => (
                <TableRow key={`${it.ts}-${i}`}>
                  <TableCell className="whitespace-nowrap pl-4 text-muted-foreground" title={fmtAbs(it.ts)}>
                    {relativeTime(it.ts)}
                  </TableCell>
                  <TableCell>
                    <span
                      className="inline-flex items-center gap-1.5"
                      title={
                        it.verified
                          ? "Hostname/Overlay-IP passt zu einem bekannten NetBird-Peer (heuristische Zuordnung, keine kryptografische Verifikation)"
                          : "Kein passender NetBird-Peer - Zuordnung unsicher"
                      }
                    >
                      {it.verified ? (
                        <ShieldCheck className="size-4 text-ok" aria-label="Gerät einem bekannten Peer zugeordnet" />
                      ) : (
                        <ShieldAlert className="size-4 text-warn" aria-label="Gerät keinem Peer zugeordnet" />
                      )}
                      <span className="font-medium">{it.device || it.hostname || "—"}</span>
                    </span>
                  </TableCell>
                  <TableCell>{it.os_user || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{roleLabel(it.role)}</TableCell>
                  <TableCell>
                    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", KIND_CLS[it.kind] ?? "bg-muted text-muted-foreground")}>
                      {kindLabel(it.kind)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{it.label || "—"}</span>
                    {it.target && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{it.target}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function fmtAbs(s?: string): string {
  if (!s) return ""
  const d = new Date(s)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleString("de-DE")
}
