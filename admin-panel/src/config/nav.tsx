import {
  LayoutDashboard, Activity, MonitorSmartphone, Radio, KeyRound, Globe, Megaphone, Rocket, HardDrive, ScrollText,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export const NAV: NavItem[] = [
  { to: "/", label: "Übersicht", icon: LayoutDashboard, end: true },
  { to: "/status", label: "Status", icon: Activity },
  { to: "/devices", label: "Geräte", icon: MonitorSmartphone },
  { to: "/aktivitaet", label: "Aktivität", icon: ScrollText },
  { to: "/peers", label: "Peers", icon: Radio },
  { to: "/keys", label: "Setup-Keys", icon: KeyRound },
  { to: "/network", label: "Netzwerk", icon: Globe },
  { to: "/news", label: "News", icon: Megaphone },
  { to: "/releases", label: "Releases", icon: Rocket },
  { to: "/system", label: "System", icon: HardDrive },
]
