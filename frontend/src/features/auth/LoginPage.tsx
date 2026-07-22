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
    <main className="auth">
      <form onSubmit={onSubmit} className="card auth-card">
        <span className="eyebrow">remnawave · xray</span>
        <h1 className="auth-title">
          Xray UI Editor<span className="auth-caret">_</span>
        </h1>
        <p className="auth-sub">Редактор конфиг-профилей панели</p>

        <div className="field">
          <label className="field-label" htmlFor="password">
            Пароль
          </label>
          <div className="jack-field">
            <TextInput
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              aria-describedby={login.isError ? 'login-error' : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {login.isError && (
            <span className="field-error" id="login-error" role="alert">
              {(login.error as Error).message}
            </span>
          )}
        </div>

        <Button type="submit" variant="primary" disabled={!password || login.isPending} style={{ width: '100%', justifyContent: 'center' }}>
          {login.isPending ? 'Проверяем…' : 'Войти'}
        </Button>
      </form>
    </main>
  )
}
