import { useState, useEffect } from "react"
import { toast } from "sonner"
import { useData } from "@/lib/data-context"
import { api, type CreateKeyInput } from "@/lib/api"
import { daysUntil } from "@/lib/format"
import { PageHeader, EmptyState, ErrorState, ExportMdButton } from "@/components/common/bits"
import { mdTable } from "@/lib/md-export"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import { macInstallCmd, winInstallCmd } from "@/lib/installcmd"
import { PROFILE_OPTIONS, roleForGroups, type ProfileRole } from "@/lib/profiles"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus, Ban, Loader2, Copy, Check, KeyRound, UserPlus, Eye, Layers } from "lucide-react"
import type { SetupKey, Group } from "@/lib/types"
import { OnboardingDialog } from "./onboarding-dialog"

const KEY_TYPE_LABEL: Record<string, string> = { "one-off": "Einmal", reusable: "Mehrfach" }
function keyTypeLabel(t: string | null | undefined): string {
  if (!t) return "—"
  return KEY_TYPE_LABEL[t] ?? t
}

export function KeysPage() {
  const { data, loading, error, refresh } = useData()
  const [createOpen, setCreateOpen] = useState(false)
  const [onboardOpen, setOnboardOpen] = useState(false)
  const [revokeT, setRevokeT] = useState<SetupKey | null>(null)
  const [revealT, setRevealT] = useState<SetupKey | null>(null)

  if (error && !data) return <ErrorState message={error} onRetry={refresh} />

  const keys = (data?.keys ?? []).slice().sort((a, b) => Number(b.valid) - Number(a.valid))

  // NetBird liefert bei den Keys nur die Gruppen-IDs; die lesbaren Namen stehen in
  // data.groups. Auf Namen aufloesen (Fallback: rohe ID, falls die Gruppe fehlt).
  const groupNames = (ids: string[]) =>
    (ids ?? [])
      .map((id) => data?.groups.find((g) => g.id === id)?.name ?? id)
      .join(", ")

  function exportMd(): string {
    const table = mdTable(
      ["Name", "Status", "Typ", "Verwendet", "Läuft ab", "Gruppen"],
      keys.map((k) => [
        k.name,
        k.valid ? "gültig" : k.revoked ? "widerrufen" : "abgelaufen",
        keyTypeLabel(k.type),
        `${k.used ?? 0} / ${k.limit ?? "∞"}`,
        k.expires,
        groupNames(k.groups),
      ]),
    )
    return `# Setup-Keys\n\nStand: ${new Date().toLocaleString("de-DE")} · ${keys.length} Keys\n\n${table}\n`
  }

  return (
    <div>
      <PageHeader
        title="Setup-Keys"
        description="Schlüssel zum Aufnehmen neuer Geräte. Hier erstellte Keys lassen sich jederzeit über „Anzeigen“ wieder einsehen."
        actions={
          <>
            <ExportMdButton filename="setup-keys" disabled={!data} onExport={exportMd} />
            <Button variant="outline" onClick={() => setCreateOpen(true)} disabled={!data}>
              <Plus className="size-4" /> Neuer Key
            </Button>
            <Button onClick={() => setOnboardOpen(true)} disabled={!data}>
              <UserPlus className="size-4" /> Onboarding
            </Button>
          </>
        }
      />

      {loading && !data ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : keys.length === 0 ? (
        <EmptyState title="Keine Setup-Keys" hint="Lege den ersten Key für das Onboarding an." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="nkk-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead className="text-right">Verwendet</TableHead>
                <TableHead>Läuft ab</TableHead>
                <TableHead>Gruppen</TableHead>
                <TableHead className="pr-4 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const du = daysUntil(k.expires)
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium" data-label="Name">{k.name}</TableCell>
                    <TableCell data-label="Status">
                      {k.valid ? (
                        <span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">gültig</span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {k.revoked ? "widerrufen" : "abgelaufen"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-label="Typ">{keyTypeLabel(k.type)}</TableCell>
                    <TableCell className="text-right tabular-nums" data-label="Verwendet">{k.used ?? 0} / {k.limit ?? "∞"}</TableCell>
                    <TableCell className={cn("tabular-nums", k.valid && du != null && du <= 30 && "text-warn")} data-label="Läuft ab">
                      {k.expires || "—"}
                      {k.valid && du != null && du <= 30 && <span className="ml-1 text-xs">({du} T.)</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-label="Gruppen">{groupNames(k.groups) || "—"}</TableCell>
                    <TableCell data-label="">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setRevealT(k)}>
                          <Eye className="size-3.5" /> Anzeigen
                        </Button>
                        {k.valid && (
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setRevokeT(k)}>
                            <Ban className="size-3.5" /> Widerrufen
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {createOpen && <CreateKeyDialog groups={data?.groups ?? []} onClose={() => setCreateOpen(false)} onDone={refresh} />}
      {onboardOpen && <OnboardingDialog groups={data?.groups ?? []} onClose={() => setOnboardOpen(false)} onDone={refresh} />}
      {revokeT && <RevokeDialog k={revokeT} onClose={() => setRevokeT(null)} onDone={refresh} />}
      {revealT && <RevealDialog k={revealT} onClose={() => setRevealT(null)} />}
    </div>
  )
}

// Maskiert einen Setup-Key: erstes Segment (z.B. "nb") sichtbar, Rest als Punkte.
function maskKey(v: string): string {
  const head = v.slice(0, 3)
  return `${head}${"•".repeat(Math.max(8, Math.min(v.length - head.length, 24)))}`
}

function RevealDialog({ k, onClose }: { k: SetupKey; onClose: () => void }) {
  const [value, setValue] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let on = true
    api
      .revealKey(k.id)
      .then((r) => {
        if (on) setValue(r.key ?? null)
      })
      .catch((e) => {
        if (on) setErr(e instanceof Error ? e.message : "Wert nicht verfügbar.")
      })
      .finally(() => {
        if (on) setBusy(false)
      })
    return () => {
      on = false
    }
  }, [k.id])

  // Shoulder-Surfing-Schutz: bei Fensterwechsel wieder maskieren und Dialog schließen.
  useEffect(() => {
    function onBlur() {
      setShown(false)
      onClose()
    }
    window.addEventListener("blur", onBlur)
    return () => window.removeEventListener("blur", onBlur)
  }, [onClose])

  // Eingeblendeten Klartext nach kurzer Zeit automatisch wieder maskieren.
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(false), 30_000)
    return () => clearTimeout(t)
  }, [shown])

  async function copy() {
    if (!value) return
    if (await copyText(value, "Schlüssel kopiert", { allowPrompt: false })) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> {k.name}
          </DialogTitle>
          <DialogDescription>Setup-Key-Wert (server-seitig gespeichert, nur hier erstellte Keys).</DialogDescription>
        </DialogHeader>
        {busy ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Lädt …
          </div>
        ) : value ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border bg-secondary/60 p-2">
              <code className="flex-1 break-all px-1 font-mono text-[13px]">{shown ? value : maskKey(value)}</code>
              <Button variant="outline" size="sm" onClick={() => setShown((s) => !s)}>
                <Eye className="size-3.5" /> {shown ? "Verbergen" : "Einblenden"}
              </Button>
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                {copied ? "Kopiert" : "Kopieren"}
              </Button>
            </div>
            {shown ? (
              <>
                <RolloutCommands keyValue={value} keyGroups={k.groups} />
                <LevelRolloutBlock keyValue={value} keyType={k.type} />
              </>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-[13px] text-muted-foreground">
                Zum Schutz vor Mitlesen ist der Schlüssel verborgen. Mit „Einblenden“ werden Schlüssel und fertige Rollout-Befehle sichtbar.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            {err || "Wert nicht verfügbar."}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const FALLBACK_EXE = "https://api.secure.nkk-hb.de/download/NKK-Secure-Access-Setup.exe"
const FALLBACK_DMG = "https://api.secure.nkk-hb.de/download/NKK-Secure-Access.dmg"

function CmdBlock({ label, cmd, note }: { label: string; cmd: string; note?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (await copyText(cmd, "Kopiert", { allowPrompt: false })) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={copy}>
          {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
          <span className="ml-1 text-[11px]">{copied ? "Kopiert" : "Kopieren"}</span>
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-secondary/70 p-2.5 font-mono text-[11px] leading-relaxed">{cmd}</pre>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  )
}

// Fertige Onboarding-Befehle mit eingebettetem Setup-Key. macOS setzt die
// Key-Datei vorab (Zero-Touch); Windows installiert silent, Key einmal einfügen.
// Das Profil (Rolle) wird aus den Key-Gruppen vorausgewaehlt und in den One-Liner
// eingebettet; die App startet danach direkt im richtigen Profil.
export function RolloutCommands({ keyValue, keyGroups }: { keyValue: string; keyGroups?: string[] }) {
  const { data } = useData()
  const exe = data?.downloads?.windows_exe ?? FALLBACK_EXE
  const dmg = data?.downloads?.macos_dmg ?? FALLBACK_DMG
  // Key-Gruppen-IDs -> Namen, daraus das Profil vorwaehlen.
  const groupNames = (keyGroups ?? []).map((id) => data?.groups.find((g) => g.id === id)?.name ?? id)
  const [profile, setProfile] = useState<ProfileRole>(() => roleForGroups(groupNames))
  // "user" = Standard -> kein Profil noetig (Rolle ist ohnehin der Default).
  const profileArg = profile === "user" ? undefined : profile
  const win = winInstallCmd(exe, `"/S","/SETUPKEY=${keyValue}"`, { progress: true, launch: true, profile: profileArg })
  // Bulletproof Universal-Installer/Updater + Zero-Touch-Key (ein gehostetes Skript).
  const mac = macInstallCmd({ setupKey: keyValue, dmgUrl: dmg, profile: profileArg })
  return (
    <div className="space-y-3 rounded-lg border bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-medium">Gerät onboarden mit diesem Key</div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Profil</span>
          <Select value={profile} onValueChange={(v) => setProfile(v as ProfileRole)}>
            <SelectTrigger className="h-7 w-[168px] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROFILE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <CmdBlock
        label="macOS · Terminal (Zero-Touch, Key wird vorab gesetzt)"
        cmd={mac}
        note={'Danach App öffnen und einmal auf „Verbinden", kein Key-Tippen nötig.'}
      />
      <CmdBlock
        label="Windows · PowerShell als Administrator"
        cmd={win}
        note="Installiert still, setzt das Profil und verbindet sich automatisch mit diesem Key."
      />
    </div>
  )
}

// Massen-Rollout über Level: fertige, idempotente Skripte mit eingebettetem Key.
// In Level als Script anlegen, auf eine Gerätegruppe anwenden -> zero-touch.
function LevelRolloutBlock({ keyValue, keyType }: { keyValue: string; keyType: string | null }) {
  const { data } = useData()
  const exe = data?.downloads?.windows_exe ?? FALLBACK_EXE
  const dmg = data?.downloads?.macos_dmg ?? FALLBACK_DMG
  const cur = data?.current_version ?? "0.0.0"
  const reusable = keyType === "reusable"
  const winLevel = [
    `$ErrorActionPreference="Stop"; $k="${keyValue}"`,
    `$rk="HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NKK Secure Access"`,
    `$cv=((Get-ItemProperty $rk -EA SilentlyContinue).DisplayVersion) -as [version]`,
    `if(-not ($cv -and $cv -ge [version]"${cur}")){`,
    winInstallCmd(exe, `"/S","/SETUPKEY=$k"`, { indent: "  " }),
    `}`,
    `$nb="$env:ProgramFiles\\NetBird\\netbird.exe"`,
    `if(Test-Path $nb){for($j=0;$j -lt 3;$j++){if((& $nb status 2>$null) -match "Management:\\s*Connected"){break}; & $nb up --setup-key $k --management-url "https://vpn.secure.nkk-hb.de" 2>$null; Start-Sleep 6}}`,
  ].join("\n")
  // Dasselbe gehostete, gegengeprüfte Skript - root-fähig (Level läuft als System):
  // installiert/updatet idempotent (NKK_MIN_VERSION überspringt wenn aktuell) und
  // legt den Key beim Konsolennutzer ab. Eine Quelle, kein Drift.
  const macLevel = macInstallCmd({ setupKey: keyValue, minVersion: cur, dmgUrl: dmg })
  return (
    <div className="space-y-3 rounded-lg border bg-card/40 p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <Layers className="size-3.5 text-muted-foreground" /> Massen-Rollout über Level
      </div>
      {!reusable ? (
        <p className="rounded-md border border-dashed p-2 text-[12px] text-muted-foreground">
          Einmal-Key: enrollt nur ein Gerät. Für einen Massen-Rollout über Level einen Mehrfach-Key (reusable) anlegen.
        </p>
      ) : (
        <>
          <ol className="ml-4 list-decimal space-y-0.5 text-[12px] text-muted-foreground">
            <li>In Level ein Script anlegen (Scripts, Run as: System).</li>
            <li>Passenden Block unten einfügen, auf die Gerätegruppe anwenden.</li>
            <li>Idempotent: aktuelle Geräte werden übersprungen, ältere aktualisiert.</li>
            <li>Der Key ist eingebettet, kein Eintippen am Gerät.</li>
          </ol>
          <CmdBlock
            label="Windows · Level-Script (Run as: System, PowerShell)"
            cmd={winLevel}
            note="Silent-Install mit Key, danach Enrollment-Selbstheilung (netbird up mit Retry)."
          />
          <CmdBlock
            label="macOS · Level-Script (Run as: System, bash)"
            cmd={macLevel}
            note="Idempotent mit Download-Retry. Hinterlegt den Key sicher beim Konsolennutzer."
          />
        </>
      )}
    </div>
  )
}

function CreateKeyDialog({ groups, onClose, onDone }: { groups: Group[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("")
  const [type, setType] = useState<"one-off" | "reusable">("one-off")
  const [limit, setLimit] = useState("1")
  const [days, setDays] = useState("365")
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function toggle(id: string) {
    setSel((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    try {
      const input: CreateKeyInput = {
        name: name.trim(),
        type,
        usage_limit: type === "reusable" ? Math.max(1, parseInt(limit) || 1) : 1,
        expires_days: Math.max(1, parseInt(days) || 365),
        auto_groups: [...sel],
      }
      const res = await api.createKey(input)
      setCreated(res.key)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler")
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!created) return
    if (await copyText(created, "Schlüssel kopiert", { allowPrompt: false })) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-ok" /> Key erstellt
              </DialogTitle>
              <DialogDescription>Jetzt kopieren. Kannst du später über „Anzeigen“ erneut einsehen.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border bg-secondary/60 p-2">
              <code className="flex-1 break-all px-1 font-mono text-[13px]">{created}</code>
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                {copied ? "Kopiert" : "Kopieren"}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => { onClose() }}>Fertig</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Neuen Setup-Key</DialogTitle>
              <DialogDescription>Für das Onboarding eines neuen Geräts.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="kn" className="mb-1.5">Name</Label>
                <Input id="kn" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Homeoffice-Mitarbeiter-16" autoFocus />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="kt" className="mb-1.5">Typ</Label>
                  <Select value={type} onValueChange={(v) => setType(v as "one-off" | "reusable")}>
                    <SelectTrigger id="kt"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one-off">Einmal</SelectItem>
                      <SelectItem value="reusable">Mehrfach</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="kl" className="mb-1.5">Limit</Label>
                  <Input
                    id="kl"
                    type="number"
                    min="1"
                    value={type === "one-off" ? "1" : limit}
                    onChange={(e) => setLimit(e.target.value)}
                    disabled={type === "one-off"}
                    title={type === "one-off" ? "Einmal-Key ist immer 1" : "Anzahl erlaubter Geräte, mindestens 1"}
                  />
                </div>
                <div>
                  <Label htmlFor="kd" className="mb-1.5">Tage gültig</Label>
                  <Input id="kd" type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} />
                </div>
              </div>
              {groups.length > 0 && (
                <div>
                  <Label className="mb-1.5">Gruppen</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => toggle(g.id)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                          sel.has(g.id) ? "border-primary bg-accent text-primary" : "text-muted-foreground hover:bg-secondary",
                        )}
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Abbrechen</Button>
              <Button onClick={create} disabled={busy || !name.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" />}Erstellen
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RevokeDialog({ k, onClose, onDone }: { k: SetupKey; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try {
      await api.revokeKey(k.id)
      toast.success("Key widerrufen.")
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
          <DialogTitle>Key widerrufen</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{k.name}</span> wird ungültig. Bereits verbundene Geräte bleiben verbunden.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} autoFocus>Abbrechen</Button>
          <Button variant="destructive" onClick={go} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}Widerrufen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
