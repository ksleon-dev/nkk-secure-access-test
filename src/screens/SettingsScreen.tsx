import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { useToast } from "../components/Toast";
import { de } from "../i18n/de";
import type { BrandingDto } from "../types/branding";
import type {
  CredentialProfileMeta,
  KeyringTestResult,
} from "../types/credentials";

interface Props {
  branding: BrandingDto;
  profiles: CredentialProfileMeta[];
  onAddProfile: () => void;
  onEditProfile: (profile: CredentialProfileMeta) => void;
  onDeleteProfile: (id: string) => void;
  onBack: () => void;
  onResetEnrollment: () => void;
}

export function SettingsScreen({
  branding,
  profiles,
  onAddProfile,
  onEditProfile,
  onDeleteProfile,
  onBack,
  onResetEnrollment,
}: Props) {
  const [autostart, setAutostart] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [keyringTest, setKeyringTest] = useState<KeyringTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    invoke<boolean>("is_autostart_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
    refreshLogs();
    // NOTE: keyring test is explicit — triggered by the user via a button so
    // the macOS Keychain access prompt does not pop every time Settings is
    // opened on unsigned dev builds.
  }, []);

  async function toggleAutostart(enable: boolean) {
    try {
      await invoke("set_autostart", { enable });
      setAutostart(enable);
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  async function refreshLogs() {
    setLoadingLogs(true);
    try {
      const lines = await invoke<string[]>("nb_logs", { lines: 200 });
      setLogs(lines);
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setLoadingLogs(false);
    }
  }

  async function runKeyringTest() {
    setTesting(true);
    try {
      const r = await invoke<KeyringTestResult>("creds_test");
      setKeyringTest(r);
    } catch (e: unknown) {
      setKeyringTest({ ok: false, backend: "?", message: String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function resetEnrollment() {
    if (!window.confirm("Wirklich zurücksetzen?")) return;
    try {
      await invoke("nb_reset_enrollment");
      toast.info("Einrichtung zurückgesetzt.");
      onResetEnrollment();
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  function deleteProfile(p: CredentialProfileMeta) {
    if (
      !window.confirm(
        `Profil "${p.label}" wirklich löschen? Wird beim nächsten Mal neu abgefragt.`
      )
    )
      return;
    onDeleteProfile(p.id);
  }

  async function quitApp() {
    try {
      await invoke("quit_app");
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 pt-4 pb-2 flex items-center gap-2 shrink-0">
        <button
          onClick={onBack}
          className="btn-ghost p-1.5 rounded-md"
          aria-label={de.settings.back}
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-bold flex-1">{de.settings.title}</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Credential profiles */}
        <Section
          title="Anmeldedaten"
          action={
            <button
              onClick={onAddProfile}
              className="text-[12px] flex items-center gap-1 px-2.5 py-1 rounded-md text-white bg-[color:var(--brand-primary)] hover:bg-[color:var(--brand-primary-hover)] font-bold transition"
            >
              <Plus size={12} strokeWidth={3} />
              Neu
            </button>
          }
        >
          <p className="text-[12px] text-[color:var(--brand-fg)]/85 mb-2 leading-snug">
            Mehrere Profile speicherbar — verschlüsselt im OS Tresor.
          </p>
          {profiles.length === 0 ? (
            <button
              onClick={onAddProfile}
              className="w-full surface hover:border-[color:var(--brand-primary)] rounded-lg px-3 py-3 text-[13px] font-semibold flex items-center justify-center gap-1.5 text-[color:var(--brand-fg)] transition"
            >
              <Plus size={14} strokeWidth={2.6} />
              Erstes Profil anlegen
            </button>
          ) : (
            <div className="flex flex-col gap-1.5">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="surface rounded-lg p-2.5 flex items-center gap-2.5"
                >
                  <Avatar profile={p} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate text-[color:var(--brand-fg)]">
                      {p.label}
                    </div>
                    <div className="text-[11px] truncate font-mono text-[color:var(--brand-fg)]/75">
                      {p.domain ? `${p.domain}\\` : ""}
                      {p.username}
                    </div>
                  </div>
                  <button
                    onClick={() => onEditProfile(p)}
                    className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
                    aria-label="Bearbeiten"
                    title="Bearbeiten"
                  >
                    <Pencil size={14} strokeWidth={2.4} />
                  </button>
                  <button
                    onClick={() => deleteProfile(p)}
                    className="p-1.5 rounded-md text-red-700 hover:bg-red-500/15 transition"
                    aria-label="Löschen"
                    title="Löschen"
                  >
                    <Trash2 size={14} strokeWidth={2.4} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Keyring test — opt-in button, so macOS keychain prompt only pops
              when the admin actively tests it */}
          {!keyringTest ? (
            <button
              onClick={runKeyringTest}
              disabled={testing}
              className="mt-2 w-full surface hover:border-[color:var(--brand-primary)] rounded-md px-3 py-2 text-[12px] font-semibold flex items-center justify-center gap-1.5 text-[color:var(--brand-fg)] transition"
            >
              {testing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {testing ? "Prüfe Schlüsselbund …" : "Schlüsselbund testen"}
            </button>
          ) : (
            <div
              className={`mt-2 rounded-md px-3 py-2 text-[12px] flex items-start gap-2 ${
                keyringTest.ok
                  ? "bg-emerald-600/15 text-emerald-900 border border-emerald-600/40"
                  : "bg-red-600/15 text-red-900 border border-red-600/40"
              }`}
            >
              {keyringTest.ok ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              ) : (
                <XCircle size={14} className="mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-bold">{keyringTest.backend}</div>
                <div className="font-medium">{keyringTest.message}</div>
              </div>
              <button
                onClick={runKeyringTest}
                disabled={testing}
                className="p-1 rounded shrink-0 hover:bg-black/10 text-black"
                title="Erneut testen"
              >
                <RefreshCw
                  size={12}
                  className={testing ? "animate-spin" : ""}
                />
              </button>
            </div>
          )}
        </Section>

        <Section title={de.settings.autostart}>
          <p className="text-[12px] text-[color:var(--brand-fg)]/85 mb-2 leading-snug">
            {de.settings.autostartHint}
          </p>
          <Toggle checked={autostart} onChange={toggleAutostart} />
        </Section>

        <Section title={de.settings.management}>
          <div className="surface rounded-md px-2.5 py-2 flex items-center gap-2">
            <Server size={14} className="text-[color:var(--brand-primary)] shrink-0" />
            <span className="text-[12px] font-mono truncate text-[color:var(--brand-fg)]">
              {branding.netbird.managementUrl}
            </span>
          </div>
        </Section>

        <Section
          title={de.settings.logsTitle}
          action={
            <button
              onClick={refreshLogs}
              disabled={loadingLogs}
              className="text-[11px] font-semibold flex items-center gap-1 px-2 py-1 rounded-md text-black hover:bg-black/10 transition"
            >
              <RefreshCw
                size={12}
                className={loadingLogs ? "animate-spin" : ""}
              />
              {de.settings.logsRefresh}
            </button>
          }
        >
          <pre className="surface allow-select rounded-md p-2 text-[11px] font-mono overflow-auto h-32 whitespace-pre-wrap leading-tight text-[color:var(--brand-fg)]">
            {logs.length === 0 ? "—" : logs.slice(-50).join("\n")}
          </pre>
        </Section>

        <Section title={de.settings.resetTitle}>
          <p className="text-[12px] text-[color:var(--brand-fg)]/85 mb-2 leading-snug">
            {de.settings.resetHint}
          </p>
          <button
            onClick={resetEnrollment}
            className="w-full surface hover:border-red-500/50 hover:bg-red-500/5 rounded-md py-2.5 text-[13px] font-bold flex items-center justify-center gap-1.5 text-red-700 transition"
          >
            <RotateCcw size={14} strokeWidth={2.4} />
            {de.settings.resetButton}
          </button>
        </Section>

        <Section title={de.settings.version}>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-[color:var(--brand-fg)]/85">
              {branding.product.name}
            </span>
            <span className="font-mono font-bold text-[color:var(--brand-fg)]">
              {branding.product.version}
            </span>
          </div>
        </Section>

        <button
          onClick={quitApp}
          className="mt-3 w-full surface hover:border-[color:var(--brand-primary)] rounded-md py-2.5 text-[13px] font-bold flex items-center justify-center gap-1.5 transition text-[color:var(--brand-fg)]"
        >
          <LogOut size={14} strokeWidth={2.4} />
          {de.settings.quitApp}
        </button>
      </div>

      {/* Permanent vendor footer */}
      <div className="text-center text-[9px] py-1.5 shrink-0 font-semibold uppercase tracking-wider text-[color:var(--brand-surface)]/80">
        {branding.vendor.footer}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 first:mt-0">
      <div className="flex items-end justify-between mb-1.5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--brand-fg)]">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors ${
        checked ? "bg-[var(--brand-primary)]" : "bg-gray-400/40"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
      <Power
        size={10}
        className={`absolute top-1.5 ${
          checked ? "left-1.5 text-white" : "right-1.5 text-gray-500"
        }`}
      />
    </button>
  );
}
