import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Check,
  ClipboardCopy,
  Gauge,
  Loader2,
  RefreshCw,
  RotateCcw,
  Shield,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "../components/Toast";
import type { BrandingDto } from "../types/branding";
import type { CredentialProfileMeta } from "../types/credentials";
import type { DebugInfo, PingResult, SmartDebugResult, SpeedResult } from "../types/debug";

interface Props {
  branding: BrandingDto;
  profile: CredentialProfileMeta | null;
  onClose: () => void;
}

export function DiagnosePanel({ branding, profile, onClose }: Props) {
  // Escape key closes panel
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );
  useEffect(() => {
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [handleEsc]);
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [pings, setPings] = useState<PingResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pingsLoading, setPingsLoading] = useState(false);
  const toast = useToast();

  async function refresh() {
    setLoading(true);
    try {
      const [d, l] = await Promise.all([
        invoke<DebugInfo>("get_debug_info"),
        invoke<string[]>("nb_logs", { lines: 30 }).catch(() => []),
      ]);
      setInfo(d);
      setLogs(l);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // Pings load SEPARATELY — page shows instantly, pings fill in after
    loadPings();
  }

  async function loadPings() {
    setPingsLoading(true);
    try {
      const p = await invoke<PingResult[]>("run_ping_test");
      setPings(p);
    } catch {
      setPings([]);
    } finally {
      setPingsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function copyDiagnose() {
    if (!info) return;
    const lines: string[] = [];
    lines.push(`=== ${branding.product.name} Diagnose ===`);
    lines.push(`Zeitpunkt: ${new Date(info.timestamp).toLocaleString("de-DE")}`);
    lines.push("");
    lines.push("── Benutzer ──────────────────────────");
    lines.push(`OS User: ${info.os_username}`);
    lines.push(`Rechner: ${info.hostname}`);
    lines.push(`OS: ${info.os_version} (${info.os_name})`);
    lines.push(`App Version: ${info.app_version}`);
    if (profile?.username) {
      lines.push(
        `AD Identität: ${profile.domain ? profile.domain + "\\" : ""}${profile.username}`
      );
    }
    lines.push("");
    lines.push("── Netzwerk ──────────────────────────");
    lines.push(`Public IP: ${info.public_ip ?? "—"}`);
    lines.push(`WireGuard IP: ${info.local_ip ?? "—"}`);
    lines.push(`Internet: ${info.internet_ok ? "OK" : "FAIL"} (ping 8.8.8.8)`);
    lines.push(
      `Netbird CLI: ${info.netbird_cli_present ? "installiert" : "FEHLT"}`
    );
    lines.push(`VPN: ${info.vpn_connected ? "verbunden" : "getrennt"}`);
    lines.push(
      `LAN ${info.lan_target}: ${info.lan_ok ? "erreichbar" : "FAIL"}`
    );
    lines.push(`Peers: ${info.peers_connected} / ${info.peers_total}`);
    lines.push(`Management: ${branding.netbird.managementUrl}`);
    if (pings && pings.length > 0) {
      lines.push("");
      lines.push("── Ping (4× Durchschnitt) ────────────");
      for (const p of pings) {
        if (p.ok) {
          lines.push(`${p.label} (${p.target}): avg ${p.avg_ms.toFixed(1)} ms (min ${p.min_ms.toFixed(0)} / max ${p.max_ms.toFixed(0)})`);
        } else {
          lines.push(`${p.label} (${p.target}): TIMEOUT`);
        }
      }
    }
    if (info.speed) {
      lines.push("");
      lines.push("── Speedtest ─────────────────────────");
      lines.push(`Ziel: ${info.speed.target}`);
      lines.push(`Latenz: ${info.speed.duration_ms} ms`);
      if (info.speed.mbps > 0) {
        lines.push(`Durchsatz: ${info.speed.mbps} Mbit/s`);
      }
    }
    lines.push("");
    lines.push("── Diagnose ──────────────────────────");
    lines.push(info.detected_issue);
    if (logs.length > 0) {
      lines.push("");
      lines.push("── Letzte Ereignisse ────────────────");
      lines.push(...logs.slice(-15));
    }
    lines.push("");
    lines.push(
      `-- bitte diesen Block an ${branding.vendor.supportEmail} schicken --`
    );

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Diagnose kopiert.");
    } catch {
      toast.error("Kopieren fehlgeschlagen.");
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 pt-4 pb-2 flex items-center gap-2 shrink-0">
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label="Zurück"
        >
          <ArrowLeft size={18} strokeWidth={2.4} />
        </button>
        <Shield size={15} className="text-[color:var(--brand-primary)]" />
        <div className="flex-1">
          <h1 className="text-sm font-bold">Diagnose & Support</h1>
          <p className="text-[10px] text-[color:var(--brand-fg)]/60">
            Für KronSolutions Support
          </p>
        </div>
        <button
          onClick={refresh}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label="Aktualisieren"
          disabled={loading}
          title="Aktualisieren"
        >
          <RefreshCw
            size={14}
            strokeWidth={2.4}
            className={loading ? "animate-spin" : ""}
          />
        </button>
      </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && !info ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Loader2 size={24} className="animate-spin text-muted" />
              <span className="text-xs text-muted">Prüfe Verbindung …</span>
            </div>
          ) : info ? (
            <div className="flex flex-col gap-3">
              {/* Diagnose Hinweis */}
              <div
                className={`rounded-lg px-3 py-2 text-[11px] leading-snug font-semibold ${
                  info.internet_ok && info.vpn_connected && info.lan_ok
                    ? "bg-emerald-500/10 text-emerald-700 border border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-700 border border-amber-500/30"
                }`}
              >
                {info.detected_issue}
              </div>

              {/* Checks */}
              <InfoBlock title="Verbindung">
                <Check3 ok={info.internet_ok} label="Internet" detail="ping 8.8.8.8" />
                <Check3
                  ok={info.netbird_cli_present}
                  label="Netbird Client"
                  detail={info.netbird_cli_present ? "installiert" : "nicht installiert"}
                />
                <Check3
                  ok={info.vpn_connected}
                  label="VPN Tunnel"
                  detail={info.vpn_connected ? "verbunden" : "getrennt"}
                />
                <Check3
                  ok={info.lan_ok}
                  label={`Firmennetz ${info.lan_target}`}
                  detail={info.lan_ok ? "erreichbar" : "kein Ping"}
                />
              </InfoBlock>

              {/* Identität */}
              <InfoBlock title="Rechner & Benutzer">
                <Row label="OS User" value={info.os_username} />
                <Row label="Hostname" value={info.hostname} />
                <Row label="Betriebssystem" value={info.os_version} />
                {profile?.username && (
                  <Row
                    label="AD Identität"
                    value={`${profile.domain ? profile.domain + "\\" : ""}${profile.username}`}
                  />
                )}
              </InfoBlock>

              {/* Netzwerk */}
              <InfoBlock title="Netzwerk">
                <Row
                  label="Public IP"
                  value={info.public_ip ?? "—"}
                  mono
                />
                <Row
                  label="WireGuard IP"
                  value={info.local_ip ?? "—"}
                  mono
                />
                <Row
                  label="Peers verbunden"
                  value={`${info.peers_connected} / ${info.peers_total}`}
                />
                <Row
                  label="Management"
                  value={branding.netbird.managementUrl.replace(/^https?:\/\//, "")}
                  mono
                />
              </InfoBlock>

              {/* Ping Results — loaded separately with own spinner */}
              <section>
                <h3 className="text-[9px] font-bold uppercase tracking-wider text-muted mb-1">
                  Verbindungsqualität (4× Ping)
                </h3>
                <div className="surface rounded-lg px-2.5 py-1.5">
                  {pingsLoading ? (
                    <div className="flex items-center gap-2 py-3 justify-center">
                      <Loader2 size={14} className="animate-spin text-muted" />
                      <span className="text-[10px] text-muted">Ping läuft …</span>
                    </div>
                  ) : pings && pings.length > 0 ? (
                    pings.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5 border-b border-[color:var(--brand-border)] last:border-b-0">
                        <Gauge size={14} className={
                          !p.ok ? "text-red-500" :
                          p.avg_ms < 30 ? "text-emerald-600" :
                          p.avg_ms < 80 ? "text-emerald-500" :
                          p.avg_ms < 150 ? "text-amber-500" :
                          "text-red-500"
                        } />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold truncate">{p.label}</div>
                          <div className="text-[9px] font-mono text-[color:var(--brand-fg)]/50">{p.target}</div>
                        </div>
                        {p.ok ? (
                          <div className="text-right shrink-0">
                            <div className="text-[13px] font-bold tabular-nums">
                              {p.avg_ms.toFixed(1)} ms
                            </div>
                            <div className="text-[8px] font-mono text-[color:var(--brand-fg)]/40">
                              {p.min_ms.toFixed(0)}–{p.max_ms.toFixed(0)} ms
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] font-bold text-red-500">Timeout</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="py-2 text-[10px] text-muted text-center">
                      Nicht verfügbar
                    </div>
                  )}
                </div>
              </section>

              {/* App */}
              <InfoBlock title="App">
                <Row label="Version" value={info.app_version} mono />
                <Row
                  label="Zeitpunkt"
                  value={new Date(info.timestamp).toLocaleString("de-DE")}
                  mono
                />
              </InfoBlock>

              {/* Smart Actions */}
              <InfoBlock title="Aktionen">
                <SpeedTestButton />
                <ActionButton
                  icon={<RotateCcw size={13} />}
                  label="NetBird neu starten"
                  hint="Trennt und verbindet VPN neu"
                  confirm="NetBird Dienst neu starten? Die VPN Verbindung wird kurz unterbrochen."
                  onClick={async () => {
                    await invoke("nb_disconnect");
                    await new Promise(r => setTimeout(r, 1000));
                    await invoke("nb_connect", {});
                    toast.success("NetBird neu gestartet.");
                    refresh();
                  }}
                />
                <SmartDebugButton onDone={refresh} />
              </InfoBlock>

              {/* Logs */}
              {logs.length > 0 && (
                <InfoBlock title={`Letzte ${Math.min(logs.length, 10)} Ereignisse`}>
                  <pre className="allow-select text-[9px] font-mono overflow-auto max-h-24 whitespace-pre-wrap leading-tight text-muted -mx-1 px-1">
                    {logs.slice(-10).join("\n")}
                  </pre>
                </InfoBlock>
              )}
            </div>
          ) : (
            <div className="text-xs text-red-500">
              Diagnose konnte nicht geladen werden.
            </div>
          )}
        </div>

        <div className="px-4 py-3 shrink-0">
          <button
            onClick={copyDiagnose}
            disabled={!info}
            className="w-full btn-primary rounded-lg py-2.5 text-xs font-bold flex items-center justify-center gap-1.5"
          >
            <ClipboardCopy size={13} />
            Diagnose für Support kopieren
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(branding.vendor.supportEmail);
                toast.success("Support Email kopiert.");
              } catch {
                toast.error("Konnte nicht kopieren.");
              }
            }}
            className="block w-full text-center text-[10px] text-[color:var(--brand-fg)]/70 mt-1.5 hover:text-[color:var(--brand-primary)] transition cursor-pointer font-semibold"
            title="Klicken zum Kopieren"
          >
            {branding.vendor.supportEmail}
          </button>
        </div>

        <div className="text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95">
          {branding.vendor.footer}
        </div>
      </div>
  );
}

function InfoBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[9px] font-bold uppercase tracking-wider text-muted mb-1">
        {title}
      </h3>
      <div className="surface rounded-lg px-2.5 py-1.5 flex flex-col">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10.5px] py-0.5 border-b border-[color:var(--brand-border)] last:border-b-0">
      <span className="text-muted shrink-0">{label}</span>
      <span
        className={`font-semibold truncate text-right ${
          mono ? "font-mono text-[9.5px]" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Check3({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1 border-b border-[color:var(--brand-border)] last:border-b-0">
      <div
        className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
          ok
            ? "bg-emerald-500/20 text-emerald-600"
            : "bg-red-500/20 text-red-600"
        }`}
      >
        {ok ? <Check size={9} strokeWidth={4} /> : <X size={9} strokeWidth={4} />}
      </div>
      <div className="flex-1 min-w-0 text-[10.5px]">
        <div className="font-semibold truncate">{label}</div>
        <div className="text-muted text-[9px] truncate">{detail}</div>
      </div>
    </div>
  );
}

function SpeedTestButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpeedResult | null>(null);
  const toast = useToast();
  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const r = await invoke<SpeedResult>("run_speed_test");
      setResult(r);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }
  return (
    <div>
      <button
        onClick={run}
        disabled={running}
        className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-[color:var(--brand-primary)]/5 transition text-left"
      >
        {running ? (
          <Loader2 size={13} className="text-[color:var(--brand-primary)] shrink-0 animate-spin" />
        ) : (
          <Gauge size={13} className="text-[color:var(--brand-primary)] shrink-0" />
        )}
        <div className="flex-1">
          <div className="text-[11px] font-bold">
            {running ? "Speedtest läuft …" : "Speedtest starten"}
          </div>
          <div className="text-[9px] text-[color:var(--brand-fg)]/50">
            10 MB Download via Cloudflare CDN
          </div>
        </div>
      </button>
      {result && (
        <div className="px-2 pb-1 flex items-center gap-2">
          <Zap size={11} className={
            result.mbps > 10 ? "text-emerald-500" :
            result.mbps > 2 ? "text-amber-500" : "text-red-500"
          } />
          <span className="text-[11px] font-bold">
            {result.mbps > 0
              ? `${result.mbps} Mbit/s`
              : `${result.duration_ms} ms`}
          </span>
          <span className="text-[9px] text-[color:var(--brand-fg)]/50">
            {result.mbps > 10 ? "Schnell" :
             result.mbps > 2 ? "OK" :
             result.mbps > 0 ? "Langsam" :
             result.duration_ms < 80 ? "Gute Latenz" : "Hohe Latenz"}
          </span>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  hint,
  confirm: confirmMsg,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  confirm?: string;
  onClick: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function handle() {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await onClick();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={handle}
      disabled={busy}
      className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-[color:var(--brand-primary)]/5 transition text-left"
    >
      <div className="text-[color:var(--brand-primary)] shrink-0">
        {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
      </div>
      <div className="flex-1">
        <div className="text-[11px] font-bold">{busy ? `${label} …` : label}</div>
        <div className="text-[9px] text-[color:var(--brand-fg)]/50">{hint}</div>
      </div>
    </button>
  );
}

function SmartDebugButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SmartDebugResult | null>(null);
  const toast = useToast();
  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const r = await invoke<SmartDebugResult>("smart_debug");
      setResult(r);
      toast.success("Smart Debug abgeschlossen.");
      onDone();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }
  return (
    <div>
      <button
        onClick={run}
        disabled={running}
        className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-emerald-500/5 transition text-left"
      >
        {running ? (
          <Loader2 size={13} className="text-emerald-600 shrink-0 animate-spin" />
        ) : (
          <Shield size={13} className="text-emerald-600 shrink-0" />
        )}
        <div className="flex-1">
          <div className="text-[11px] font-bold">
            {running ? "Prüfe & repariere …" : "Smart Debug"}
          </div>
          <div className="text-[9px] text-[color:var(--brand-fg)]/50">
            Prüft alles und versucht Probleme automatisch zu beheben
          </div>
        </div>
      </button>
      {result && (
        <div className="px-2 pb-1">
          <div className={`text-[10px] font-semibold mb-1 ${
            result.steps.every(s => s.ok) ? "text-emerald-700" : "text-amber-700"
          }`}>
            {result.summary}
          </div>
          {result.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[9px] py-0.5">
              {s.ok
                ? <Check size={8} strokeWidth={4} className="text-emerald-500 shrink-0" />
                : <X size={8} strokeWidth={4} className="text-red-500 shrink-0" />
              }
              <span className="font-semibold">{s.name}</span>
              <span className="text-[color:var(--brand-fg)]/50">{s.detail}</span>
              {s.action_taken && (
                <span className="text-emerald-600 font-bold">→ {s.action_taken}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
