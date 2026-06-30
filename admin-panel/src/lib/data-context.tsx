import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { api, AuthError } from "./api"
import type { DashboardData } from "./types"

interface DataState {
  data: DashboardData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => Promise<void>
  onUnauthorized: () => void
}

const Ctx = createContext<DataState | null>(null)

export function DataProvider({ children, onUnauthorized }: { children: ReactNode; onUnauthorized: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setError(null)
    try {
      const d = await api.data()
      setData(d)
      setLastUpdated(new Date())
    } catch (e) {
      if (e instanceof AuthError) {
        onUnauthorized()
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setLoading(false)
      busy.current = false
    }
  }, [onUnauthorized])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <Ctx.Provider value={{ data, loading, error, lastUpdated, refresh, onUnauthorized }}>
      {children}
    </Ctx.Provider>
  )
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error("useData must be used within DataProvider")
  return v
}
