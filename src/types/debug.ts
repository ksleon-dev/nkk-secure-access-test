export interface SpeedResult {
  target: string;
  bytes: number;
  duration_ms: number;
  mbps: number;
}

export interface DebugInfo {
  os_username: string;
  hostname: string;
  os_name: string;
  os_version: string;
  app_version: string;
  internet_ok: boolean;
  vpn_connected: boolean;
  netbird_cli_present: boolean;
  lan_target: string;
  lan_ok: boolean;
  local_ip: string | null;
  public_ip: string | null;
  peers_total: number;
  peers_connected: number;
  detected_issue: string;
  speed: SpeedResult | null;
  timestamp: string;
}

export interface SmartDebugStep {
  name: string;
  ok: boolean;
  detail: string;
  action_taken: string | null;
}

export interface SmartDebugResult {
  steps: SmartDebugStep[];
  summary: string;
}
