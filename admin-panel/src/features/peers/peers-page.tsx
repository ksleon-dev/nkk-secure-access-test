import { useState } from "react"
import { toast } from "sonner"
import { useData } from "@/lib/data-context"
import { api } from "@/lib/api"
import { relativeTime } from "@/lib/format"
import { PageHeader, ConnBadge, EmptyState, ErrorState, ExportMdButton } from "@/components/common/bits"
import { mdTable } from "@/lib/md-export"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pencil, UserMinus, Loader2 } from "lucide-react"
import type { Peer } from "@/lib/types"

export function PeersPage() {
  const { data, loading, error, refresh } = useData()
  const [renameT, setRenameT] = useState<Peer | null>(null)
  const [deleteT, setDeleteT] = useState<Peer | null>(null)

  if (error && !data) return <ErrorState message={error} onRetry={refresh} />

  const peers = data?.peers ?? []
  const online = peers.filter((p) => p.connected).length

  function exportMd(): string {
    const table = mdTable(
      ["Name", "Status", "NetBird-IP", "Agent", "OS", "Zuletzt gesehen"],
      peers.map((p) => [
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

  return (
    <div>
      <PageHeader
        title="Peers"
        description={data ? `${peers.length} Peers · ${online} online` : undefined}
        actions={<ExportMdButton filename="peers" disabled={!data} onExport={exportMd} />}
      />

      {loading && !data ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : peers.length === 0 ? (
        <EmptyState title="Keine Peers" hint="Erstelle einen Setup-Key, um Geräte aufzunehmen." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="nkk-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>NetBird-IP</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {peers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium" data-label="Name">{p.name}</TableCell>
                  <TableCell data-label="Status"><ConnBadge connected={p.connected} /></TableCell>
                  <TableCell className="font-mono text-[12.5px] text-muted-foreground tabular-nums" data-label="NetBird-IP">{p.ip ?? "—"}</TableCell>
                  <TableCell className="font-mono text-[12.5px] text-muted-foreground tabular-nums" data-label="Agent">{p.version ?? "—"}</TableCell>
                  <TableCell className="capitalize text-muted-foreground" data-label="OS">{p.os ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums" data-label="Last seen">{relativeTime(p.last_seen)}</TableCell>
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {renameT && <RenameDialog peer={renameT} onClose={() => setRenameT(null)} onDone={refresh} />}
      {deleteT && <OffboardDialog peer={deleteT} onClose={() => setDeleteT(null)} onDone={refresh} />}
    </div>
  )
}

function RenameDialog({ peer, onClose, onDone }: { peer: Peer; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(peer.name)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await api.renamePeer(peer.id, name.trim())
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
          <Button onClick={save} disabled={busy || !name.trim()}>
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
