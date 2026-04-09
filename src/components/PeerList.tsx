import clsx from "clsx";
import { Activity, Wifi, WifiOff } from "lucide-react";
import type { PeerDto } from "../types/netbird";
import { de } from "../i18n/de";

export function PeerList({ peers }: { peers: PeerDto[] }) {
  if (peers.length === 0) {
    return (
      <div className="text-xs text-muted text-center py-3">{de.main.noPeers}</div>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {peers.map((p, i) => (
        <li
          key={`${p.name}-${i}`}
          className="flex items-center gap-2 surface rounded-md px-2.5 py-1.5"
        >
          {p.connected ? (
            <Wifi size={14} className="text-green-600 shrink-0" />
          ) : (
            <WifiOff size={14} className="text-muted shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{shortName(p.name)}</div>
            <div className="text-[10px] text-muted truncate">{p.ip}</div>
          </div>
          {typeof p.latency_ms === "number" && (
            <span
              className={clsx(
                "flex items-center gap-1 text-[10px] tabular-nums",
                latencyColor(p.latency_ms)
              )}
            >
              <Activity size={10} />
              {p.latency_ms} ms
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function shortName(fqdn: string): string {
  return fqdn.replace(/\.netbird\.cloud$|\.nkk\.internal$/i, "");
}

function latencyColor(ms: number): string {
  if (ms < 50) return "text-green-600";
  if (ms < 150) return "text-yellow-500";
  return "text-red-500";
}
