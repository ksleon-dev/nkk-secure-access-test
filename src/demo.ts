import type { StatusDto } from "./types/netbird";

export const DEMO_FLAG = "nkk-demo-mode";

export function isDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG) === "1";
  } catch {
    return false;
  }
}

export function enableDemoMode() {
  try {
    localStorage.setItem(DEMO_FLAG, "1");
  } catch {
    /* ignore */
  }
}

export function disableDemoMode() {
  try {
    localStorage.removeItem(DEMO_FLAG);
  } catch {
    /* ignore */
  }
}

export function makeDemoStatus(connected: boolean): StatusDto {
  if (!connected) {
    return {
      state: "Disconnected",
      management_connected: false,
      peers: [],
      local_ip: null,
      updated_at: new Date().toISOString(),
      cli_available: true,
    };
  }
  return {
    state: "Connected",
    management_connected: true,
    peers: [
      {
        name: "Serv-TS2",
        ip: "192.168.0.20",
        connected: true,
        latency_ms: 18,
        relay: "P2P",
      },
      {
        name: "Serv-TS1",
        ip: "192.168.0.19",
        connected: true,
        latency_ms: 22,
        relay: "P2P",
      },
      {
        name: "Serv-File DC",
        ip: "192.168.0.10",
        connected: true,
        latency_ms: 16,
        relay: "P2P",
      },
      {
        name: "Serv-DB",
        ip: "192.168.0.18",
        connected: true,
        latency_ms: 19,
        relay: "P2P",
      },
      {
        name: "Serv-App",
        ip: "192.168.0.36",
        connected: true,
        latency_ms: 24,
        relay: "P2P",
      },
    ],
    local_ip: "192.168.250.100",
    updated_at: new Date().toISOString(),
    cli_available: true,
  };
}
