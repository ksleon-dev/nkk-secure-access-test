import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { LinkQuality } from "../types/debug";
import { Sparkline } from "./Sparkline";

const MAX_HISTORY = 30;

const STATUS: Record<string, { label: string; color: string; dot: string }> = {
  gut: { label: "gut", color: "text-emerald-700", dot: "#10b981" },
  okay: { label: "okay", color: "text-amber-700", dot: "#d97706" },
  degradiert: { label: "degradiert", color: "text-red-600", dot: "#dc2626" },
  weg: { label: "keine Antwort", color: "text-red-700", dot: "#991b1b" },
};

// Samples latency/jitter/loss to the terminal servers and the domain controller
// every few seconds while visible, keeps a short rolling history and draws a
// sparkline per target. Stops sampling as soon as it is hidden.
export function ConnectionQuality({ active }: { active: boolean }) {
  const [rows, setRows] = useState<LinkQuality[]>([]);
  const histRef = useRef<Map<string, number[]>>(new Map());
  const [, force] = useState(0);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const q = await invoke<LinkQuality[]>("measure_link_quality");
        if (!alive) return;
        setRows(q);
        for (const r of q) {
          const h = histRef.current.get(r.target) ?? [];
          h.push(r.ok ? r.avgMs : 0);
          if (h.length > MAX_HISTORY) h.shift();
          histRef.current.set(r.target, h);
        }
        force((n) => n + 1);
      } catch {
        /* ignore a failed sample, try again next tick */
      }
      if (alive) timer = setTimeout(tick, 4000);
    }
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active]);

  if (rows.length === 0) {
    return (
      <div className="text-[10px] text-muted py-1">
        Verbinde dich mit dem VPN, dann wird die Qualität gemessen.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const st = STATUS[r.status] ?? STATUS.okay;
        const hist = (histRef.current.get(r.target) ?? []).filter((v) => v > 0);
        return (
          <div
            key={r.target}
            className="surface rounded-lg px-2.5 py-2 flex items-center gap-2.5"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: st.dot }}
                />
                <span className="text-[12px] font-semibold truncate">
                  {r.label}
                </span>
                <span className={`text-[9px] font-bold uppercase ${st.color}`}>
                  {st.label}
                </span>
              </div>
              <div className="text-[10px] text-muted mt-0.5 tabular-nums">
                {r.ok
                  ? `${r.avgMs} ms · Jitter ${r.jitterMs} ms · Verlust ${r.lossPct}%`
                  : "keine Antwort"}
              </div>
            </div>
            <Sparkline values={hist} color={st.dot} />
          </div>
        );
      })}
    </div>
  );
}
