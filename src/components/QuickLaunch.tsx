import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  ArrowRight,
  Folder,
  Globe,
  Loader2,
  Monitor,
  Star,
} from "lucide-react";
import { useState } from "react";
import type { QuickLaunchEntry } from "../types/branding";
import type { ConnectionState } from "../types/netbird";
import { de } from "../i18n/de";
import { useToast } from "./Toast";

interface QuickLaunchProps {
  items: QuickLaunchEntry[];
  state: ConnectionState;
}

export function QuickLaunch({ items, state }: QuickLaunchProps) {
  if (items.length === 0) return null;
  const sorted = [...items].sort(
    (a, b) => Number(!!b.default) - Number(!!a.default)
  );
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((item) => (
        <QuickLaunchRow
          key={`${item.type}:${item.target}`}
          item={item}
          state={state}
        />
      ))}
    </div>
  );
}

function QuickLaunchRow({
  item,
  state,
}: {
  item: QuickLaunchEntry;
  state: ConnectionState;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const Icon = pickIcon(item);
  const disabled = state !== "Connected";

  async function launch() {
    setBusy(true);
    try {
      const cmd =
        item.type === "rdp"
          ? "open_rdp"
          : item.type === "smb"
          ? "open_smb"
          : "open_url";
      await invoke(cmd, { target: item.target });
      toast.success(de.quickLaunch[item.type].starting);
    } catch (e: unknown) {
      toast.error(`${de.quickLaunch[item.type].failed} ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel =
    item.type === "rdp"
      ? "Verbinden"
      : item.type === "smb"
      ? "Öffnen"
      : "Starten";

  return (
    <div
      className={clsx(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition surface",
        item.default && "ring-1 ring-[color:var(--brand-primary)]/30"
      )}
    >
      <div
        className={clsx(
          "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
          item.default
            ? "bg-[var(--brand-primary)] text-white"
            : "bg-[color:var(--brand-primary)]/10 text-[var(--brand-primary)]"
        )}
      >
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold truncate">{item.label}</span>
          {item.default && (
            <Star
              size={11}
              className="text-[var(--brand-primary)] fill-[var(--brand-primary)] shrink-0"
            />
          )}
        </div>
        {item.description && (
          <div className="text-[10px] text-muted truncate">
            {item.description}
          </div>
        )}
      </div>
      <button
        onClick={launch}
        disabled={disabled || busy}
        className={clsx(
          "shrink-0 flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition",
          "btn-primary",
          disabled && "opacity-40 cursor-not-allowed"
        )}
        aria-label={`${buttonLabel} ${item.label}`}
        title={
          disabled
            ? "Erst VPN verbinden"
            : `${buttonLabel}: ${item.target}`
        }
      >
        {busy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <ArrowRight size={11} />
        )}
        {buttonLabel}
      </button>
    </div>
  );
}

function pickIcon(item: QuickLaunchEntry) {
  if (item.icon === "folder" || item.type === "smb") return Folder;
  if (item.icon === "globe" || item.type === "url") return Globe;
  return Monitor;
}
