import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { MtuProbe } from "../types/debug";

const TONE: Record<string, string> = {
  optimal: "text-emerald-700",
  niedrig: "text-amber-700",
  unbekannt: "text-muted",
};

// Measures the path MTU to the internal anchor and shows whether the tunnel
// MTU is fine or should be lowered. A too-high MTU over WireGuard is the most
// common silent cause of "RDP is laggy" / stalled transfers.
export function PathMtu() {
  const [data, setData] = useState<MtuProbe | null>(null);
  const [loading, setLoading] = useState(false);

  async function probe() {
    setLoading(true);
    try {
      setData(await invoke<MtuProbe>("probe_mtu"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    probe();
  }, []);

  return (
    <div className="surface rounded-lg px-2.5 py-2 mt-1.5 flex items-center gap-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold">Pfad-MTU</span>
          {data && (
            <span
              className={`text-[9px] font-bold uppercase ${TONE[data.status] ?? "text-muted"}`}
            >
              {data.status}
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted mt-0.5 leading-snug">
          {loading ? "messe …" : data ? data.note : "nicht gemessen"}
        </div>
      </div>
      <button
        onClick={probe}
        disabled={loading}
        className="btn-ghost rounded-md p-1.5 text-[color:var(--brand-primary)] shrink-0"
        aria-label="MTU erneut messen"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RefreshCw size={14} />
        )}
      </button>
    </div>
  );
}
