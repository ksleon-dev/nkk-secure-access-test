import { useCallback, useEffect, useState, type ReactNode } from "react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Lock, ShieldCheck } from "lucide-react"

type Phase = "checking" | "out" | "in"

export function AuthGate({ children }: { children: (onUnauthorized: () => void) => ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking")

  const check = useCallback(async () => {
    try {
      const r = await api.session()
      setPhase(r.authed ? "in" : "out")
    } catch {
      setPhase("out")
    }
  }, [])

  useEffect(() => {
    check()
  }, [check])

  if (phase === "checking") {
    return (
      <div className="grid min-h-svh place-items-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (phase === "out") {
    return <LoginScreen onSuccess={() => setPhase("in")} />
  }

  return <>{children(() => setPhase("out"))}</>
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!pw) return
    setBusy(true)
    setErr(null)
    try {
      await api.login(pw)
      onSuccess()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      // Konkrete Backend-Meldung zeigen (z.B. "Gesperrt, noch 240s"); sonst generisch.
      setErr(msg && msg !== "nicht angemeldet" ? msg : "Passwort falsch.")
      setPw("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-svh place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <div className="text-[15px] font-semibold leading-tight">NKK Secure Access</div>
            <div className="text-sm text-muted-foreground">Admin Console</div>
          </div>
        </div>
        <form onSubmit={submit} className="rounded-xl border bg-card p-5">
          <label htmlFor="pw" className="mb-1.5 block text-sm font-medium">
            Session-Passwort
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pw"
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="pl-9"
              placeholder="••••"
              aria-invalid={!!err}
            />
          </div>
          {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
          <Button type="submit" className="mt-4 w-full" disabled={busy || !pw}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Anmelden
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Erreichbar nur über das NetBird-Overlay (admin-only).
        </p>
      </div>
    </div>
  )
}
