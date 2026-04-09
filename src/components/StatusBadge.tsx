import clsx from "clsx";
import { CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import type { ConnectionState, StatusDto } from "../types/netbird";
import { de } from "../i18n/de";

interface StatusBadgeProps {
  status: StatusDto | null;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const state: ConnectionState = status?.state ?? "Disconnected";

  const meta = (() => {
    if (status && !status.cli_available) {
      return {
        label: de.status.cliMissing,
        color: "text-amber-500",
        bg: "bg-amber-500/10",
        ring: "ring-amber-500/30",
        Icon: XCircle,
        spin: false,
      };
    }
    switch (state) {
      case "Connected":
        return {
          label: de.status.connected,
          color: "text-green-600",
          bg: "bg-green-500/10",
          ring: "ring-green-500/30",
          Icon: CheckCircle2,
          spin: false,
        };
      case "Connecting":
        return {
          label: de.status.connecting,
          color: "text-blue-500",
          bg: "bg-blue-500/10",
          ring: "ring-blue-500/30",
          Icon: Loader2,
          spin: true,
        };
      case "Error":
        return {
          label: de.status.error,
          color: "text-red-500",
          bg: "bg-red-500/10",
          ring: "ring-red-500/30",
          Icon: XCircle,
          spin: false,
        };
      default:
        return {
          label: de.status.disconnected,
          color: "text-muted",
          bg: "bg-gray-500/10",
          ring: "ring-gray-500/20",
          Icon: MinusCircle,
          spin: false,
        };
    }
  })();

  const { Icon } = meta;

  return (
    <div
      className={clsx(
        "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1",
        meta.bg,
        meta.color,
        meta.ring
      )}
    >
      <Icon size={14} className={clsx(meta.spin && "animate-spin")} />
      <span>{meta.label}</span>
    </div>
  );
}
