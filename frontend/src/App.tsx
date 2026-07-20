import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { LoginPage } from './features/auth/LoginPage'
import { RequireAuth } from './features/auth/RequireAuth'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

function ProfilesPagePlaceholder() {
  return <main style={{ padding: 24 }}>Профили</main>
}

function EditorPagePlaceholder() {
  return <main style={{ padding: 24 }}>Редактор</main>
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <ProfilesPagePlaceholder />
              </RequireAuth>
            }
          />
          <Route
            path="/profiles/:uuid"
            element={
              <RequireAuth>
                <EditorPagePlaceholder />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
