import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  ArrowRight,
  Info,
  Loader2,
  Settings as SettingsIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Decor } from "../components/Decor";
import { Logo } from "../components/Logo";
import { TaglineMark } from "../components/TaglineMark";
import { useToast } from "../components/Toast";
import { de } from "../i18n/de";
import { bioFootnote, italicAccent, timeOfDayGreeting } from "../lib/greeting";
import type { BrandingDto, QuickLaunchEntry } from "../types/branding";
import { displayName, type CredentialProfileMeta } from "../types/credentials";
import type { ConnectionState, StatusDto } from "../types/netbird";

interface Props {
  branding: BrandingDto;
  status: StatusDto | null;
  profile: CredentialProfileMeta | null;
  onRequestLaunch: (item: QuickLaunchEntry) => Promise<void> | void;
  onOpenCredentials: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}

export function MainScreen({
  branding,
  status,
  profile,
  onRequestLaunch,
  onOpenCredentials,
  onOpenSettings,
  onOpenAbout,
}: Props) {
  const [busy, setBusy] = useState(false);
  const pendingToggle = useRef(false); // prevent double-click race condition
  const toast = useToast();
  const state: ConnectionState = status?.state ?? "Disconnected";
  const isConnected = state === "Connected";
  const isBusy = busy || state === "Connecting";

  const greetingName = displayName(profile);
  const greeting = timeOfDayGreeting();
  const accent = italicAccent(state);
  void bioFootnote;

  // Live clock + date — updates every 30s
  function formatDateTime() {
    const now = new Date();
    const time = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const date = now.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
    return { time, date };
  }
  const [dateTime, setDateTime] = useState(formatDateTime);
  useEffect(() => {
    const id = setInterval(() => setDateTime(formatDateTime()), 30_000);
    return () => clearInterval(id);
  }, []);

  const launches = [...branding.quickLaunch].sort(
    (a, b) => Number(!!b.default) - Number(!!a.default)
  );

  async function toggle() {
    if (pendingToggle.current) return;
    pendingToggle.current = true;
    setBusy(true);
    try {
      if (isConnected) {
        await invoke("nb_disconnect");
        toast.info(de.toast.disconnected);
      } else {
        await invoke("nb_connect", {});
        toast.success(de.toast.connected);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(false);
      pendingToggle.current = false;
    }
  }

  return (
    <div className="h-full flex flex-col relative">
      <Decor />
      {/* Top utility bar pinned to top */}
      <header className="absolute top-2 left-3 right-2 z-20 flex items-center gap-1">
        <div className="flex-1">
          <span className="text-[13px] font-bold text-[color:var(--brand-fg)]/85 tabular-nums">
            {dateTime.time}
          </span>
          <span className="text-[10px] ml-1.5 text-[color:var(--brand-fg)]/55">
            {dateTime.date}
          </span>
        </div>
        <Avatar
          profile={profile}
          size={28}
          onClick={onOpenCredentials}
          title={
            profile?.username
              ? `${profile.label} (${profile.username})`
              : "Anmeldedaten einrichten"
          }
        />
        <button
          onClick={onOpenAbout}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label="Diagnose & Support"
          title="Diagnose & Support"
        >
          <Info size={17} strokeWidth={2.4} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label={de.main.settings}
          title={de.main.settings}
        >
          <SettingsIcon size={17} strokeWidth={2.4} />
        </button>
      </header>

      {/* Centered hero — content sits directly on the cream background */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 gap-3 py-2 text-center">
        <div className="fade-in-1 flex flex-col items-center">
          <Logo branding={branding} size={104} />
          <TaglineMark width={180} className="mt-1.5" />
        </div>

        <div className="fade-in-2 mt-1">
          <div className="font-serif-display text-[22px] leading-[1.0]">
            {greeting}
            {greetingName ? `, ${greetingName}` : ""}.
          </div>
          <div
            className="font-serif-display italic text-[18px] leading-[1.0] mt-0.5"
            style={{ color: "var(--brand-primary)" }}
          >
            {accent}
          </div>
        </div>

        <div className="fade-in-3 w-full flex flex-col gap-2 mt-1">
          {launches.map((item, i) => (
            <LaunchCard
              key={item.target}
              item={item}
              primary={i === 0}
              disabled={!isConnected }
              onClick={() => onRequestLaunch(item)}
            />
          ))}
          {!isConnected  && launches.length > 0 && (
            <div className="text-[11px] text-center mt-0.5 italic text-[color:var(--brand-fg)]/70">
              {status && !status.cli_available
                ? "Kein VPN Client installiert — bitte Administrator kontaktieren."
                : "Erst VPN verbinden um Server zu öffnen."}
            </div>
          )}
        </div>
      </main>

      {/* VPN Status Bar — clearly distinct between connected / disconnected */}
      <div
        className={clsx(
          "fade-in-5 relative z-10 px-4 shrink-0 transition-colors duration-300",
          isConnected
            ? "bg-emerald-600 py-2"
            : state === "Connecting"
            ? "bg-amber-500 py-2"
            : state === "Error"
            ? "bg-red-600 py-2"
            : "bg-[color:var(--brand-primary)] py-2.5"
        )}
      >
        <div className="flex items-center gap-2">
          {/* Status icon */}
          {isBusy ? (
            <Loader2 size={14} className="animate-spin text-white shrink-0" />
          ) : (
            <div
              className={clsx(
                "w-2.5 h-2.5 rounded-full shrink-0",
                isConnected                   ? "bg-white animate-pulse-soft"
                  : "bg-white/50"
              )}
            />
          )}

          {/* Status text */}
          <span className="flex-1 text-[12px] font-bold text-white truncate">
            {isConnected               ? `Verbunden${status?.local_ip ? ` — ${status.local_ip}` : ""}`
              : state === "Connecting"
              ? "Verbinde …"
              : state === "Error"
              ? "Verbindung gestört"
              : "VPN aus"}
          </span>

          {/* Toggle button */}
          <button
            onClick={toggle}
            disabled={isBusy || (status ? !status.cli_available  : false)}
            className={clsx(
              "rounded-full px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider transition",
              isConnected                 ? "bg-white/20 hover:bg-white/30 text-white border border-white/30"
                : "bg-[color:var(--brand-primary)] hover:bg-[color:var(--brand-primary-hover)] text-white",
              isBusy && "opacity-50 cursor-not-allowed"
            )}
          >
            {isBusy
              ? "…"
              : isConnected               ? "Trennen"
              : "Verbinden"}
          </button>
        </div>
      </div>

      {/* Permanent KronSolutions footer */}
      <div className="relative z-10 text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95">
        {branding.vendor.footer}
      </div>
    </div>
  );
}

function LaunchCard({
  item,
  primary,
  disabled,
  onClick,
}: {
  item: QuickLaunchEntry;
  primary: boolean;
  disabled: boolean;
  onClick: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function handle() {
    setBusy(true);
    try {
      await onClick();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handle}
      disabled={disabled || busy}
      className={clsx(
        "w-full rounded-xl px-4 py-3.5 flex items-center gap-3 text-left transition group",
        primary
          ? "btn-primary hover:-translate-y-0.5"
          : "surface hover:border-[color:var(--brand-primary)]/50 hover:-translate-y-0.5",
        (disabled || busy) && "opacity-50 cursor-not-allowed hover:translate-y-0"
      )}
      title={`${item.label} (${item.target})`}
    >
      <div
        className={clsx(
          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
          primary
            ? "bg-white/15"
            : "bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]"
        )}
      >
        {busy ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <ArrowRight
            size={18}
            className="transition group-hover:translate-x-0.5"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={clsx(
            "text-[15px] font-bold leading-tight truncate",
            primary ? "text-white" : ""
          )}
        >
          {item.label}
        </div>
        {item.description && (
          <div
            className={clsx(
              "text-[10px] truncate mt-0.5",
              primary ? "text-white/80" : "text-muted"
            )}
          >
            {item.description}
          </div>
        )}
      </div>
    </button>
  );
}
