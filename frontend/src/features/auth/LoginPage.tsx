import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLogin } from '../../shared/api'
import { Button, TextInput } from '../../shared/ui'

export function LoginPage() {
  const [password, setPassword] = useState('')
  const login = useLogin()
  const navigate = useNavigate()

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    login.mutate(password, { onSuccess: () => navigate('/') })
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <form onSubmit={onSubmit} className="card" style={{ width: 340 }}>
        <h1 className="mono" style={{ marginBottom: 4 }}>
          Xray UI Editor<span style={{ color: 'var(--in)' }}>_</span>
        </h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Редактор конфигов Remnawave
        </p>
        <div className="field">
          <label className="field-label" htmlFor="password">
            Пароль
          </label>
          <TextInput
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {login.isError && <span className="field-error">{(login.error as Error).message}</span>}
        </div>
        <Button type="submit" variant="primary" disabled={!password || login.isPending} style={{ width: '100%' }}>
          Войти
        </Button>
      </form>
    </main>
  )
}
