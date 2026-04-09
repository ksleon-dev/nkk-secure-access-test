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
  timestamp: string;
}
