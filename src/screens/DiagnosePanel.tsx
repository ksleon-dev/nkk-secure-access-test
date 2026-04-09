import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ClipboardCopy,
  Loader2,
  RefreshCw,
  Shield,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "../components/Toast";
import type { BrandingDto } from "../types/branding";
import type { CredentialProfileMeta } from "../types/credentials";
import type { DebugInfo } from "../types/debug";

interface Props {
  branding: BrandingDto;
  profile: CredentialProfileMeta | null;
  onClose: () => void;
}

export function DiagnosePanel({ branding, profile, onClose }: Props) {
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
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
      toast.error(String(e));
    } finally {
      setLoading(false);
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
    <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="surface rounded-xl w-full max-w-sm shadow-2xl flex flex-col max-h-[95%]">
        <header className="px-4 py-3 border-b border-[color:var(--brand-border)] flex items-center gap-2 shrink-0">
          <Shield size={15} className="text-[color:var(--brand-primary)]" />
          <h2 className="text-sm font-bold flex-1">Diagnose</h2>
          <button
            onClick={refresh}
            className="btn-ghost p-1.5 rounded-md"
            aria-label="Aktualisieren"
            disabled={loading}
            title="Aktualisieren"
          >
            <RefreshCw
              size={13}
              className={loading ? "animate-spin" : ""}
            />
          </button>
          <button
            onClick={onClose}
            className="btn-ghost p-1.5 rounded-md"
            aria-label="Schließen"
          >
            <X size={14} />
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

              {/* App */}
              <InfoBlock title="App">
                <Row label="Version" value={info.app_version} mono />
                <Row
                  label="Zeitpunkt"
                  value={new Date(info.timestamp).toLocaleString("de-DE")}
                  mono
                />
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

        <div className="px-4 py-3 border-t border-[color:var(--brand-border)] shrink-0">
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
            className="block w-full text-center text-[9px] text-[color:var(--brand-fg)]/80 mt-1.5 hover:text-[color:var(--brand-primary)] transition cursor-pointer"
            title="Klicken zum Kopieren"
          >
            {branding.vendor.supportEmail}
          </button>
        </div>
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
