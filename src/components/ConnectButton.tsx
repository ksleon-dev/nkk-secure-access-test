import clsx from "clsx";
import { Loader2, Power, PowerOff } from "lucide-react";
import type { ConnectionState } from "../types/netbird";

interface ConnectButtonProps {
  state: ConnectionState;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  disabled?: boolean;
}

/**
 * Pill-style connect/disconnect button matching the NKK shop "SHOP-WARTUNG"
 * pill aesthetic. Red when disconnected, green when connected.
 */
export function ConnectButton({
  state,
  busy,
  onConnect,
  onDisconnect,
  disabled,
}: ConnectButtonProps) {
  const isOn = state === "Connected";
  const isBusy = busy || state === "Connecting";

  const label = isBusy
    ? "Verbinde …"
    : isOn
    ? "Verbunden — Trennen"
    : "Mit dem Tunnel verbinden";

  return (
    <button
      onClick={isOn ? onDisconnect : onConnect}
      disabled={disabled || isBusy}
      className={clsx(
        "group inline-flex items-center gap-2 rounded-full font-bold uppercase tracking-wider text-[11px] transition-all",
        "px-5 py-2.5 select-none",
        "shadow-[0_8px_24px_-8px_rgba(124,30,30,0.4)]",
        isOn
          ? "bg-emerald-600 hover:bg-emerald-700 text-white"
          : "bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white",
        (disabled || isBusy) && "opacity-60 cursor-not-allowed",
        !isBusy && "active:scale-95 hover:shadow-[0_12px_30px_-8px_rgba(124,30,30,0.55)]"
      )}
      aria-label={label}
    >
      {isBusy ? (
        <Loader2 size={13} className="animate-spin" strokeWidth={3} />
      ) : isOn ? (
        <PowerOff size={13} strokeWidth={3} />
      ) : (
        <Power size={13} strokeWidth={3} />
      )}
      {label}
    </button>
  );
}
