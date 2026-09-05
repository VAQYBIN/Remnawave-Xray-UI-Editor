import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { lazy, Suspense } from 'react'
import { LoginPage } from './features/auth/LoginPage'
import { RequireAuth } from './features/auth/RequireAuth'
import { AuthError } from './shared/api'

const ProfilesPage = lazy(() =>
  import('./features/profiles/ProfilesPage').then((m) => ({ default: m.ProfilesPage })),
)
const EditorPage = lazy(() =>
  import('./features/editor/EditorPage').then((m) => ({ default: m.EditorPage })),
)
const TemplatesPage = lazy(() =>
  import('./features/templates/TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
)
const TemplateEditorPage = lazy(() =>
  import('./features/templates/TemplateEditorPage').then((m) => ({ default: m.TemplateEditorPage })),
)

function onAuthError(err: unknown) {
  if (err instanceof AuthError && window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      retry: (failureCount, err) => !(err instanceof AuthError) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<main style={{ padding: 24 }} className="muted">Загрузка…</main>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <ProfilesPage />
                </RequireAuth>
              }
            />
            <Route
              path="/profiles/:uuid"
              element={
                <RequireAuth>
                  <EditorPage />
                </RequireAuth>
              }
            />
            <Route
              path="/templates"
              element={
                <RequireAuth>
                  <TemplatesPage />
                </RequireAuth>
              }
            />
            <Route
              path="/templates/:uuid"
              element={
                <RequireAuth>
                  <TemplateEditorPage />
                </RequireAuth>
              }
            />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
