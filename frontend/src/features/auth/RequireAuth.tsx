import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useMe } from '../../shared/api'

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  if (me.isPending) {
    return <main style={{ padding: 24 }} className="muted">Проверка сессии…</main>
  }
  if (me.isError) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
