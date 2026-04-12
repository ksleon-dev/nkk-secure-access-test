import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  ArrowRight,
  Headphones,
  Loader2,
  Newspaper,
  Settings as SettingsIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Decor } from "../components/Decor";
import { Logo } from "../components/Logo";
import { TaglineMark } from "../components/TaglineMark";
import { useToast } from "../components/Toast";
import { de } from "../i18n/de";
import { italicAccent, timeOfDayGreeting } from "../lib/greeting";
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
  onOpenNews: () => void;
}

export function MainScreen({
  branding,
  status,
  profile,
  onRequestLaunch,
  onOpenCredentials,
  onOpenSettings,
  onOpenAbout,
  onOpenNews,
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

  // Track state transitions for animations
  const prevState = useRef(state);
  const transition = useMemo(() => {
    const was = prevState.current;
    prevState.current = state;
    if (state === "Connected" && was !== "Connected") return "connected";
    if (state === "Disconnected" && was === "Connected") return "disconnected";
    if (state === "Connecting") return "connecting";
    return "none";
  }, [state]);

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
    const minBusy = new Promise((r) => setTimeout(r, 2500)); // particles visible min 2.5s
    try {
      if (isConnected) {
        await Promise.all([invoke("nb_disconnect"), minBusy]);
        toast.info(de.toast.disconnected);
      } else {
        await Promise.all([invoke("nb_connect", {}), minBusy]);
        toast.success(de.toast.connected);
      }
    } catch (e: unknown) {
      await minBusy; // show particles even on error
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
      <header className="relative z-20 px-3 pt-3 pb-2 flex items-center gap-1 bg-[color:var(--brand-bg-soft)] border-b border-[color:var(--brand-border)]">
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
          onClick={onOpenNews}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label="Aktuelles"
          title="Aktuelles & Changelog"
        >
          <Newspaper size={16} strokeWidth={2.4} />
        </button>
        <button
          onClick={onOpenAbout}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label="Diagnose & Support"
          title="Diagnose & Support"
        >
          <Headphones size={16} strokeWidth={2.4} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label={de.main.settings}
          title={de.main.settings}
        >
          <SettingsIcon size={16} strokeWidth={2.4} />
        </button>
      </header>

      {/* Centered hero — content sits directly on the cream background */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 gap-3 py-2 text-center">
        <div className="fade-in-1 flex flex-col items-center">
          <div
            className="relative flex items-center justify-center cursor-pointer"
            style={{ width: 120, height: 120 }}
            onClick={() => { /* logo tap — no action */ }}
          >
            {/* Professional particles — cherry red dots + subtle BIO labels */}
            {isBusy && (
              <>
                {[
                  { angle: "0deg",   dist: "90px", speed: 1.3, delay: 0,   sz: 5, color: "#B51F29" },
                  { angle: "50deg",  dist: "85px", speed: 1.5, delay: 0.2, sz: 4, color: "#4a8c3f" },
                  { angle: "95deg",  dist: "88px", speed: 1.4, delay: 0.5, sz: 5, color: "#B51F29" },
                  { angle: "140deg", dist: "82px", speed: 1.6, delay: 0.3, sz: 4, color: "#e8a317" },
                  { angle: "185deg", dist: "90px", speed: 1.3, delay: 0.7, sz: 5, color: "#4a8c3f" },
                  { angle: "230deg", dist: "80px", speed: 1.5, delay: 0.1, sz: 4, color: "#B51F29" },
                  { angle: "275deg", dist: "86px", speed: 1.4, delay: 0.6, sz: 5, color: "#e8a317" },
                  { angle: "320deg", dist: "84px", speed: 1.6, delay: 0.4, sz: 4, color: "#4a8c3f" },
                  { angle: "25deg",  dist: "92px", speed: 1.7, delay: 0.8, sz: 5, color: "#B51F29" },
                  { angle: "210deg", dist: "82px", speed: 1.3, delay: 0.9, sz: 4, color: "#e8a317" },
                ].map((p, i) => (
                  <div
                    key={i}
                    className="logo-particle"
                    style={{
                      "--angle": p.angle,
                      "--dist": p.dist,
                      animationDuration: `${p.speed}s`,
                      animationDelay: `${p.delay}s`,
                      width: p.sz,
                      height: p.sz,
                      borderRadius: "50%",
                      background: p.color,
                    } as React.CSSProperties}
                  />
                ))}
              </>
            )}
            {/* Green dots burst on connect */}
            {transition === "connected" && !isBusy && (
              <>
                {Array.from({ length: 8 }, (_, i) => (
                  <div
                    key={i}
                    className="logo-particle logo-particle-green"
                    style={{
                      "--angle": `${i * 45}deg`,
                      "--dist": "92px",
                      animationDelay: `${i * 0.04}s`,
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#10b981",
                    } as React.CSSProperties}
                  />
                ))}
              </>
            )}
            <Logo
              branding={branding}
              size={104}
              className={clsx(
                "relative z-10 transition-transform duration-300",
                isBusy && "logo-float",
                transition === "connected" && !isBusy && "logo-connected-pop"
              )}
            />
          </div>
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
          "py-2.5",
          isConnected
            ? "bg-emerald-600"
            : state === "Connecting"
            ? "bg-amber-500"
            : state === "Error"
            ? "bg-red-600"
            : "bg-[color:var(--brand-primary)]",
          transition === "connected" && "vpn-connected-enter",
          transition === "disconnected" && "vpn-disconnect-enter"
        )}
      >
        {/* Connecting shimmer overlay */}
        {state === "Connecting" && (
          <div className="absolute inset-0 vpn-connecting-bar rounded-inherit" />
        )}

        <div className="relative flex items-center gap-2">
          {/* Status dot — always same size to prevent layout jump */}
          <div
            className={clsx(
              "w-2.5 h-2.5 rounded-full shrink-0 transition-colors",
              isBusy ? "bg-white vpn-connecting-dot" :
              isConnected ? "bg-white dot-connected" : "bg-white/50",
              transition === "connected" && "vpn-dot-pulse"
            )}
          />

          {/* Status text — fixed min-width so layout doesn't jump on state change */}
          <span className="flex-1 text-[12px] font-bold text-white truncate min-h-[18px]">
            {isConnected
              ? `Verbunden${status?.local_ip ? ` — ${status.local_ip}` : ""}`
              : state === "Connecting"
              ? "Verbinde …"
              : state === "Error"
              ? "Verbindung gestört"
              : "Nicht verbunden"}
          </span>

          {/* Toggle button — single element, changes style not structure */}
          <button
            onClick={toggle}
            disabled={isBusy || (!isConnected && status ? !status.cli_available : false)}
            className={clsx(
              "relative rounded-full py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all min-w-[100px]",
              isConnected
                ? "px-3 bg-white/20 hover:bg-white/30 text-white border border-white/30"
                : "px-4 bg-white text-[color:var(--brand-primary)] shadow-lg hover:shadow-xl active:scale-95",
              isBusy && "opacity-50 cursor-not-allowed"
            )}
          >
            {!isConnected && !isBusy && (
              <span className="absolute inset-0 rounded-full bg-white/60 vpn-glow-ring" />
            )}
            <span className="relative">
              {isBusy ? "…" : isConnected ? "Trennen" : "▶ Verbinden"}
            </span>
          </button>
        </div>
      </div>

      {/* Permanent KronSolutions footer */}
      <div
        className="relative z-10 text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95"
      >
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
