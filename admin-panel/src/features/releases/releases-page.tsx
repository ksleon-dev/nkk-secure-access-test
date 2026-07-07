import { useRef, useState, type ReactNode } from "react"
import { useData } from "@/lib/data-context"
import { api } from "@/lib/api"
import { PageHeader, ErrorState, RolloutCard, ExportMdButton } from "@/components/common/bits"
import { mdTable } from "@/lib/md-export"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle2, XCircle, Download, FileText, Copy, Check, Loader2 } from "lucide-react"
import { copyText } from "@/lib/clipboard"
import { macInstallCmd, winInstallCmd, winRolloutCmd } from "@/lib/installcmd"
import { RolloutCommands } from "@/features/keys/keys-page"
import { cn } from "@/lib/utils"
import changelogRaw from "@/data/changelog.md?raw"

const DL_EXE = "https://api.secure.nkk-hb.de/download/NKK-Secure-Access-Setup.exe"
const DL_ZIP = "https://api.secure.nkk-hb.de/download/NKK-Secure-Access.zip"

interface Version {
  version: string
  date: string
  body: string
}

function parseChangelog(raw: string): Version[] {
  const re = /^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?\s*$/gm
  const ms = [...raw.matchAll(re)]
  return ms.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < ms.length ? (ms[i + 1].index ?? raw.length) : raw.length
    return { version: m[1], date: (m[2] || "").trim(), body: raw.slice(start, end).trim() }
  })
}

const VERSIONS = parseChangelog(changelogRaw)

function Notes({ body }: { body: string }) {
  return (
    <div className="space-y-1.5">
      {body.split("\n").map((ln, i) => {
        const t = ln.trim()
        if (!t) return null
        if (t.startsWith("### "))
          return <div key={i} className="mt-3 text-[13px] font-semibold text-muted-foreground">{t.slice(4)}</div>
        if (t.startsWith("- "))
          return (
            <div key={i} className="flex gap-2 text-sm text-muted-foreground">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary/50" />
              <span>{t.slice(2)}</span>
            </div>
          )
        return <p key={i} className="text-sm text-muted-foreground">{t}</p>
      })}
    </div>
  )
}

// Onboarding direkt auf der Releases-Seite: Key waehlen -> Wert serverseitig holen ->
// Profil waehlen + fertige Befehle (RolloutCommands, dieselbe Komponente wie im Keys-Dialog).
function OnboardCard() {
  const { data } = useData()
  const keys = (data?.keys ?? []).filter((k) => k.valid && !k.revoked)
  const groups = data?.groups ?? []
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id
  const [keyId, setKeyId] = useState("")
  const [value, setValue] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = keys.find((k) => k.id === keyId)
  // Stale-Response-Guard: bei schnellem Key-Wechsel darf eine spaet eintreffende
  // Antwort des ALTEN Requests nie den Wert unter dem NEUEN Key anzeigen - der
  // kopierte One-Liner wuerde sonst mit dem falschen Setup-Key enrollen.
  const reqSeq = useRef(0)

  async function pick(id: string) {
    setKeyId(id)
    setValue(null)
    setErr(null)
    const req = ++reqSeq.current
    if (!id) return
    setBusy(true)
    try {
      const r = await api.revealKey(id)
      if (req !== reqSeq.current) return // veraltet: inzwischen anderer Key gewaehlt
      if (r.key) setValue(r.key)
      else setErr("Für diesen Key ist kein Wert gespeichert (nur im Panel erstellte Keys sind hier nutzbar).")
    } catch (e) {
      if (req !== reqSeq.current) return
      setErr(e instanceof Error ? e.message : "Wert nicht verfügbar.")
    } finally {
      if (req === reqSeq.current) setBusy(false)
    }
  }

  return (
    <div className="mb-7 rounded-xl border bg-card p-5">
      <h2 className="mb-1 text-[15px] font-semibold">Gerät onboarden — Key + Profil</h2>
      <p className="mb-4 text-[13px] text-muted-foreground">
        Key wählen und Profil setzen. Der fertige Befehl installiert, setzt das Profil und verbindet automatisch.
      </p>
      <div className="max-w-md">
        <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Setup-Key</label>
        <Select value={keyId} onValueChange={pick}>
          <SelectTrigger>
            <SelectValue placeholder="Key wählen …" />
          </SelectTrigger>
          <SelectContent>
            {keys.length === 0 ? (
              <div className="px-2 py-1.5 text-[13px] text-muted-foreground">Keine gültigen Keys — auf der Keys-Seite anlegen.</div>
            ) : (
              keys.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.name}
                  {k.groups.length ? ` · ${k.groups.map(groupName).join(", ")}` : ""}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      {busy && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Lädt …
        </div>
      )}
      {err && <p className="mt-3 rounded-lg border border-dashed p-3 text-[13px] text-muted-foreground">{err}</p>}
      {value && selected && (
        <div className="mt-4">
          <RolloutCommands keyValue={value} keyGroups={selected.groups} />
        </div>
      )}
    </div>
  )
}

export function ReleasesPage() {
  const { data, loading, error, refresh } = useData()
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />
  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Releases" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }
  if (!data) return null

  const uc = data.status.update_channel
  const cur = data.current_version
  const channelOk = !!uc?.ok
  const dl = data.downloads ?? { windows_exe: DL_EXE, windows_zip: DL_ZIP, macos_dmg: null }
  const winCmd = winInstallCmd(dl.windows_exe, '"/S"', { progress: true, launch: true })
  // Bulletproof Universal-Installer/Updater (ein gehostetes Skript, kein Drift).
  const macCmd = macInstallCmd()

  function exportMd(): string {
    const table = mdTable(
      ["Version", "Datum", "Status"],
      VERSIONS.map((v) => {
        const unrel = /unreleased/i.test(v.version)
        return [
          unrel ? "Nächste Version" : "v" + v.version,
          v.date,
          v.version === cur ? "aktuell" : unrel ? "in Arbeit" : "",
        ]
      }),
    )
    return (
      `# Releases\n\nStand: ${new Date().toLocaleString("de-DE")}\n\n` +
      `Aktuelle Version (Code): v${cur}\n\n` +
      `Update-Kanal (latest.json): ${channelOk ? `aktiv · v${uc?.version}` : "inaktiv"}\n\n` +
      `## Versionsverlauf\n\n${table}\n`
    )
  }

  return (
    <div>
      <PageHeader
        title="Releases"
        description="Auslieferung, Auto-Update-Kanal und Versionsverlauf."
        actions={<ExportMdButton filename="releases" onExport={exportMd} />}
      />

      <div className="mb-5">
        <RolloutCard devices={data.devices} current={cur} />
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <SyncCard label="Aktuelle Version (Code)" value={cur} ok />
        <SyncCard label="Update-Kanal (latest.json)" value={channelOk ? `aktiv · v${uc?.version}` : "inaktiv"} ok={channelOk} />
      </div>

      {!channelOk && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-l-4 border-l-destructive bg-card p-4">
          <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="text-sm">
            <div className="font-medium">Auto-Update-Kanal liefert nichts{uc?.error ? ` (${uc.error})` : ""}.</div>
            <p className="mt-0.5 text-muted-foreground">
              Code ist auf {cur}, aber es gibt kein veröffentlichtes Release mit <span className="font-mono">latest.json</span>.
              Bis ein Release raus ist, brauchen Geräte den manuellen Download.
            </p>
          </div>
        </div>
      )}

      {/* Update auf bereits eingerichtete Clients (ohne Key). Erstinstallation = Onboarding-Karte unten. */}
      <div className="mb-7 rounded-xl border bg-card p-5">
        <h2 className="mb-1 text-[15px] font-semibold">Update auf Clients (ohne Setup-Key)</h2>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Nur für <span className="font-medium">bereits eingerichtete</span> Geräte: aktualisiert auf die neueste Version{cur ? ` (v${cur})` : ""} ohne Enrollment. <span className="font-medium">Neue Geräte immer über „Onboarding mit Key und Profil" unten</span> — sonst fragt die App nach dem Key.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <InstallCard
            os="Windows"
            sub={data.status.exe ? `${Math.round(data.status.exe.size_mb)} MB · ${data.status.exe.mtime}` : undefined}
            href={dl.windows_exe}
            altHref={dl.windows_zip}
            altLabel=".zip · PW nkk"
            cmd={winCmd}
          />
          <InstallCard os="macOS" href={dl.macos_dmg ?? undefined} cmd={macCmd} />
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Windows-Befehl in PowerShell, macOS-Befehl im Terminal. Neue Geräte NICHT hiermit aufsetzen — dafür die Onboarding-Karte mit Key und Profil unten.
        </p>
      </div>

      <OnboardCard />

      {/* Komplett-Rollout via Level: App + NetBird updaten + SSH scharf, alles silent */}
      <div className="mb-7 rounded-xl border bg-card p-5">
        <h2 className="mb-1 text-[15px] font-semibold">Komplett-Rollout via Level (Windows)</h2>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Ein Befehl im Level-Terminal (Run as System): aktualisiert NKK Secure Access <span className="font-medium">und</span> den NetBird-Client und schaltet NetBird-SSH am Client scharf. Silent, idempotent, kein Setup-Key nötig. Auf ein Gerät oder eine Gerätegruppe anwenden.
        </p>
        <CodeCopy code={winRolloutCmd()} label="Level · Run as System" />
        <p className="mt-3 text-[12px] text-muted-foreground">
          Lädt das eine gehostete, gegengeprüfte Skript (kein Drift, Verbesserungen wirken sofort). Hinweis: nicht eingeloggte Geräte bekommen SSH erst beim nächsten App-Connect; die SSH-Access-Policy im NetBird-Management ist getrennt und einmalig.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold">
          <FileText className="size-4 text-muted-foreground" /> Versionsverlauf &amp; Patchnotes
        </h2>
        <div className="space-y-5">
          {VERSIONS.map((v) => {
            const unrel = /unreleased/i.test(v.version)
            return (
              <div key={v.version} className="border-l-2 border-border pl-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className={"font-mono text-sm font-semibold " + (v.version === cur ? "text-ok" : "")}>
                    {unrel ? "Nächste Version" : "v" + v.version}
                  </span>
                  {v.date && <span className="text-xs text-muted-foreground tabular-nums">{v.date}</span>}
                  {v.version === cur && <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">aktuell</span>}
                  {unrel && <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[11px] font-medium text-warn">in Arbeit</span>}
                </div>
                <Notes body={v.body} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SyncCard({ label, value, ok }: { label: string; value: ReactNode; ok?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="size-4 shrink-0 text-ok" /> : <XCircle className="size-4 shrink-0 text-destructive" />}
        <span className="text-lg font-semibold tabular-nums">{value}</span>
      </div>
      <div className="mt-1 text-[13px] font-medium text-muted-foreground">{label}</div>
    </div>
  )
}

function InstallCard({
  os,
  sub,
  href,
  altHref,
  altLabel,
  cmd,
}: {
  os: string
  sub?: string
  href?: string
  altHref?: string
  altLabel?: string
  cmd: string | null
}) {
  return (
    <div className="rounded-lg border bg-background/40 p-3.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">
          {os}
          {sub ? <span className="ml-2 text-[12px] font-normal text-muted-foreground tabular-nums">{sub}</span> : null}
        </div>
        <div className="flex gap-1.5">
          {href && (
            <Button asChild variant="default" size="sm">
              <a href={href} target="_blank" rel="noopener noreferrer">
                <Download className="size-3.5" /> Laden
              </a>
            </Button>
          )}
          {altHref && altLabel && (
            <Button asChild variant="outline" size="sm">
              <a href={altHref} target="_blank" rel="noopener noreferrer">
                {altLabel}
              </a>
            </Button>
          )}
        </div>
      </div>
      {cmd ? (
        <CodeCopy code={cmd} label={os === "Windows" ? "PowerShell · als Admin" : "Terminal"} />
      ) : (
        <div className="rounded-md border border-dashed p-2 text-[12px] text-muted-foreground">Noch kein Release-Download verfügbar.</div>
      )}
    </div>
  )
}

function CodeCopy({ code, label = "Befehl" }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  async function doCopy() {
    if (await copyText(code, "Befehl kopiert")) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }
  return (
    <div className="overflow-hidden rounded-md border bg-secondary/50">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 py-1 pl-2.5 pr-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <button
          onClick={doCopy}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors",
            copied ? "text-ok" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Kopiert" : "Kopieren"}
        </button>
      </div>
      <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[11.5px] leading-relaxed">{code}</pre>
    </div>
  )
}
