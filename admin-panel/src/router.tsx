import { createBrowserRouter } from "react-router"
import { AppShell } from "@/components/layout/app-shell"
import { DashboardPage } from "@/features/dashboard/dashboard-page"
import { DevicesPage } from "@/features/devices/devices-page"
import { StatusPage } from "@/features/status/status-page"
import { PeersPage } from "@/features/peers/peers-page"
import { KeysPage } from "@/features/keys/keys-page"
import { NetworkPage } from "@/features/network/network-page"
import { NewsPage } from "@/features/news/news-page"
import { ReleasesPage } from "@/features/releases/releases-page"
import { SystemPage } from "@/features/system/system-page"

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppShell />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: "status", element: <StatusPage /> },
        { path: "devices", element: <DevicesPage /> },
        { path: "peers", element: <PeersPage /> },
        { path: "keys", element: <KeysPage /> },
        { path: "network", element: <NetworkPage /> },
        { path: "news", element: <NewsPage /> },
        { path: "releases", element: <ReleasesPage /> },
        { path: "system", element: <SystemPage /> },
        { path: "*", element: <DashboardPage /> },
      ],
    },
  ],
  { basename: "/" },
)
