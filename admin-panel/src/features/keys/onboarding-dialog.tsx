import { useState } from "react"
import { toast } from "sonner"
import { useData } from "@/lib/data-context"
import { api } from "@/lib/api"
import { copyText } from "@/lib/clipboard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Copy, Check, UserPlus } from "lucide-react"
import type { Group } from "@/lib/types"

const FALLBACK_EXE = "https://api.secure.nkk-hb.de/download/NKK-Secure-Access-Setup.exe"

function mailText(key: string, exeUrl: string): string {
  return `Betreff: Euer neuer Fernzugang ist da

Hallo zusammen,

wir haben einen neuen, einfacheren Fernzugang vorbereitet. Hier ist der Installer:

${exeUrl}

So geht die Einrichtung:
1. Den Link oben anklicken und die Datei speichern.
2. Die Datei per Doppelklick starten.
3. Falls Windows "Der Computer wurde geschuetzt" zeigt:
   "Weitere Informationen" -> "Trotzdem ausfuehren".
4. Den Installer durchklicken, die App oeffnet sich automatisch.
5. Diesen Aktivierungsschluessel eingeben:

   ${key}

6. Den gewuenschten Server auswaehlen und wie gewohnt arbeiten.

Bei Problemen: in der App oben rechts auf das Kopfhoerer-Symbol,
dann "Diagnose kopieren" und an support@ticket.kronsolutions.de senden.

Viele Gruesse
Euer IT-Team
KronSolutions GmbH`
}

export function OnboardingDialog({ groups, onClose, onDone }: { groups: Group[]; onClose: () => void; onDone: () => void }) {
  const { data } = useData()
  const exeUrl = data?.downloads?.windows_exe ?? FALLBACK_EXE
  const homeoffice = groups.find((g) => /homeoffice/i.test(g.name))
  const [name, setName] = useState("")
  const [group, setGroup] = useState(homeoffice?.id ?? "")
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState<string | null>(null)
  const [copied, setCopied] = useState<"key" | "mail" | null>(null)

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    try {
      const res = await api.createKey({
        name: name.trim(),
        type: "one-off",
        usage_limit: 1,
        expires_days: 365,
        auto_groups: group ? [group] : [],
      })
      setKey(res.key)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler")
    } finally {
      setBusy(false)
    }
  }

  async function copy(what: "key" | "mail") {
    if (!key) return
    const ok = await copyText(what === "key" ? key : mailText(key, exeUrl), what === "key" ? "Schlüssel kopiert" : "Mailtext kopiert", { allowPrompt: false })
    if (ok) {
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {!key ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="size-4" /> Mitarbeiter onboarden
              </DialogTitle>
              <DialogDescription>Erstellt einen Einmal-Schlüssel und den fertigen Einladungstext.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="on" className="mb-1.5">Name / Bezeichnung</Label>
                <Input id="on" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Homeoffice-Mitarbeiter-16" autoFocus />
              </div>
              {groups.length > 0 && (
                <div>
                  <Label htmlFor="og" className="mb-1.5">Gruppe</Label>
                  <Select value={group} onValueChange={setGroup}>
                    <SelectTrigger id="og"><SelectValue placeholder="Gruppe wählen" /></SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Abbrechen</Button>
              <Button onClick={create} disabled={busy || !name.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" />}Schlüssel erstellen
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="size-4 text-ok" /> Bereit zum Versenden
              </DialogTitle>
              <DialogDescription>Kannst du später über „Anzeigen“ erneut einsehen. Mailtext enthält Link + Schlüssel + Anleitung.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="mb-1.5">Aktivierungsschlüssel</Label>
                <div className="flex items-center gap-2 rounded-lg border bg-secondary/60 p-2">
                  <code className="flex-1 break-all px-1 font-mono text-[13px]">{key}</code>
                  <Button variant="outline" size="sm" onClick={() => copy("key")}>
                    {copied === "key" ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="mb-1.5">Einladungstext (Mail)</Label>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border bg-secondary/40 p-3 text-[12px] leading-relaxed">{mailText(key, exeUrl)}</pre>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => copy("mail")}>
                {copied === "mail" ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
                Mailtext kopieren
              </Button>
              <Button onClick={onClose}>Fertig</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
