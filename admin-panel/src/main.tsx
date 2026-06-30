import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router"
import "./index.css"
import { AuthGate } from "@/features/auth/AuthGate"
import { DataProvider } from "@/lib/data-context"
import { router } from "@/router"
import { Toaster } from "@/components/ui/sonner"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      {(onUnauthorized) => (
        <DataProvider onUnauthorized={onUnauthorized}>
          <RouterProvider router={router} />
        </DataProvider>
      )}
    </AuthGate>
    <Toaster position="bottom-center" richColors />
  </StrictMode>,
)
