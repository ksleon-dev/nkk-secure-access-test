import { useMemo, useState } from "react"
import { toast } from "sonner"
import { useData } from "@/lib/data-context"
import { api } from "@/lib/api"
import { relativeTime, daysSince } from "@/lib/format"
import { PageHeader, ConnBadge, AgentVersion, EmptyState, ErrorState, ExportMdButton } from "@/components/common/bits"
import { mdTable } from "@/lib/md-export"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { Pencil, UserMinus, Loader2, Search, ArrowUpDown, ChevronUp, ChevronDown, Copy } from "lucide-react"
import { useContextMenu, type CtxMenuItem } from "@/components/row-context-menu"
import { copyText } from "@/lib/clipboard"
import type { Peer } from "@/lib/types"

type SortKey = "name" | "connected" | "ip" | "version" | "os" | "last_seen"
type PeerFilter = "all" | "online" | "offline"

function sortValue(p: Peer, key: SortKey): string | number | null {
  switch (key) {
    case "connected":
      return p.connected ? 1 : 0
    case "last_seen":
      return p.last_seen ? Date.parse(p.last_seen) : null
    case "ip":
      return p.ip ?? null
    case "version":
      return p.version ?? null
    case "os":
      return p.os ?? null
    default:
      return p.name ?? null
  }
}

// Offline-Dauer farblich abstufen: frisch (<7d) neutral, bis 45d amber, darueber rot.
function offlineTone(days: number | null): string {
  if (days == null) return "text-muted-foreground"
  if (days < 7) return "text-muted-foreground"
  if (days < 45) return "text-warn"
  return "text-destructive"
}

export function PeersPage() {
  const { data, loading, error, refresh } = useData()
  const [renameT, setRenameT] = useState<Peer | null>(null)
  const [deleteT, setDeleteT] = useState<Peer | null>(null)
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<PeerFilter>("all")
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" })

  const peers = data?.peers ?? []
  const online = peers.filter((p) => p.connected).length
  const netbirdCurrent = data?.netbird_current ?? ""

  const ctx = useContextMenu()
  const peerMenu = (p: Peer): CtxMenuItem[] => {
    const items: CtxMenuItem[] = [
      { kind: "header", label: p.name, sublabel: p.ip ?? undefined },
      { kind: "sep" },
      { label: "Umbenennen", icon: Pencil, onSelect: () => setRenameT(p) },
    ]
    if (p.ip) {
      const ip = p.ip
      items.push({ label: "NetBird-IP kopieren", icon: Copy, onSelect: () => copyText(ip) })
    }
    items.push({ kind: "sep" })
    items.push({ label: "Offboarden", icon: UserMinus, danger: true, onSelect: () => setDeleteT(p) })
    return items
  }

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "last_seen" || key === "connected" ? "desc" : "asc" },
    )
  }

  const rows = useMemo(() => {
    let list = [...peers]
    if (filter === "online") list = list.filter((p) => p.connected)
    else if (filter === "offline") list = list.filter((p) => !p.connected)
    const needle = q.trim().toLowerCase()
    if (needle)
      list = list.filter((p) =>
        [p.name, p.ip, p.os, p.version].some((x) => String(x ?? "").toLowerCase().includes(needle)),
      )
    list.sort((a, b) => {
      const va = sortValue(a, sort.key)
      const vb = sortValue(b, sort.key)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const base =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true })
      return sort.dir === "asc" ? base : -base
    })
    return list
  }, [peers, q, filter, sort])

  if (error && !data) return <ErrorState message={error} onRetry={refresh} />

  function exportMd(): string {
    const table = mdTable(
      ["Name", "Status", "NetBird-IP", "Agent", "OS", "Zuletzt gesehen"],
      rows.map((p) => [
        p.name,
        p.connected ? "online" : "offline",
        p.ip,
        p.version,
        p.os,
        relativeTime(p.last_seen),
      ]),
    )
    return `# Peers\n\nStand: ${new Date().toLocaleString("de-DE")} · ${peers.length} Peers · ${online} online\n\n${table}\n`
  }

  const FILTERS: { key: PeerFilter; label: string }[] = [
    { key: "all", label: "Alle" },
    { key: "online", label: "Online" },
    { key: "offline", label: "Offline" },
  ]

  return (
    <div>
      <PageHeader
        title="Peers"
        description={data ? `${peers.length} Peers · ${online} online` : undefined}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen…" className="h-10 w-64 pl-9" />
            </div>
            <ExportMdButton filename="peers" disabled={!data} onExport={exportMd} />
          </>
        }
      />

      {data && peers.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                filter === f.key
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {f.label}
              {f.key === "online" && ` · ${online}`}
              {f.key === "offline" && ` · ${peers.length - online}`}
            </button>
          ))}
        </div>
      )}

      {loading && !data ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : peers.length === 0 ? (
        <EmptyState title="Keine Peers" hint="Erstelle einen Setup-Key, um Geräte aufzunehmen." />
      ) : rows.length === 0 ? (
        <EmptyState title="Keine Peers gefunden" hint="Suche oder Filter anpassen." />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="nkk-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHead label="Name" k="name" sort={sort} onSort={toggleSort} className="pl-4" />
                <SortHead label="Status" k="connected" sort={sort} onSort={toggleSort} />
                <SortHead label="NetBird-IP" k="ip" sort={sort} onSort={toggleSort} />
                <SortHead label="Agent" k="version" sort={sort} onSort={toggleSort} />
                <SortHead label="OS" k="os" sort={sort} onSort={toggleSort} />
                <SortHead label="Zuletzt gesehen" k="last_seen" sort={sort} onSort={toggleSort} />
                <TableHead className="pr-4 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const offDays = p.connected ? null : daysSince(p.last_seen)
                return (
                  <TableRow key={p.id} onContextMenu={(e) => ctx.open(e, peerMenu(p))}>
                    <TableCell className="font-medium pl-4" data-label="Name">{p.name}</TableCell>
                    <TableCell data-label="Status"><ConnBadge connected={p.connected} /></TableCell>
                    <TableCell className="font-mono text-[12.5px] text-muted-foreground tabular-nums" data-label="NetBird-IP">{p.ip ?? "—"}</TableCell>
                    <TableCell data-label="Agent">
                      {p.version ? (
                        <AgentVersion version={p.version} current={netbirdCurrent} />
                      ) : (
                        <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">—</span>
                      )}
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground" data-label="OS">{p.os ?? "—"}</TableCell>
                    <TableCell className="tabular-nums" data-label="Zuletzt gesehen">
                      <span className={cn("text-muted-foreground", offDays != null && offlineTone(offDays))}>
                        {relativeTime(p.last_seen)}
                      </span>
                      {offDays != null && offDays >= 45 && (
                        <span className="ml-1.5 text-xs text-muted-foreground">· Offboard prüfen</span>
                      )}
                    </TableCell>
                    <TableCell data-label="">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setRenameT(p)}>
                          <Pencil className="size-3.5" /> Umbenennen
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteT(p)}>
                          <UserMinus className="size-3.5" /> Offboard
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {renameT && <RenameDialog peer={renameT} onClose={() => setRenameT(null)} onDone={refresh} />}
      {deleteT && <OffboardDialog peer={deleteT} onClose={() => setDeleteT(null)} onDone={refresh} />}
      {ctx.node}
    </div>
  )
}

function SortHead({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; dir: "asc" | "desc" }
  onSort: (k: SortKey) => void
  className?: string
}) {
  const active = sort.key === k
  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  )
}

function RenameDialog({ peer, onClose, onDone }: { peer: Peer; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(peer.name)
  const [busy, setBusy] = useState(false)
  async function save() {
    const next = name.trim()
    // Unveraenderter Name: kein NetBird-PUT, einfach schliessen.
    if (!next || next === peer.name) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await api.renamePeer(peer.id, next)
      toast.success("Peer umbenannt.")
      onClose()
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Peer umbenennen</DialogTitle>
          <DialogDescription>Aktueller Name: {peer.name}</DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save} disabled={busy || !name.trim() || name.trim() === peer.name}>
            {busy && <Loader2 className="size-4 animate-spin" />}Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OffboardDialog({ peer, onClose, onDone }: { peer: Peer; onClose: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  async function go() {
    if (confirm.trim().toLowerCase() !== peer.name.toLowerCase()) {
      toast.error("Name stimmt nicht.")
      return
    }
    setBusy(true)
    try {
      await api.deletePeer(peer.id)
      toast.success("Gerät offboarded.")
      onClose()
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gerät offboarden</DialogTitle>
          <DialogDescription>
            Entfernt <span className="font-medium text-foreground">{peer.name}</span> dauerhaft aus dem NetBird-Netz.
            Zum Bestätigen den Namen eintippen.
          </DialogDescription>
        </DialogHeader>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`${peer.name}: zum Bestätigen eintippen`} autoFocus />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button variant="destructive" onClick={go} disabled={busy || confirm.trim().toLowerCase() !== peer.name.toLowerCase()}>
            {busy && <Loader2 className="size-4 animate-spin" />}Endgültig entfernen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
