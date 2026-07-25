import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useLogin } from '../../shared/api'
import { Button, TextInput } from '../../shared/ui'

/**
 * Знак продукта — сечение коммутационного гнезда (джека): стальные кольца и
 * живое ядро с сигнальным градиентом flux→ember. Тот же язык, что у кабелей графа.
 */
function JackMark() {
  return (
    <svg className="auth-mark" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="jack-core" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--flux)" />
          <stop offset="100%" stopColor="var(--ember)" />
        </linearGradient>
      </defs>
      <circle cx="15" cy="15" r="13" stroke="var(--rail-hi)" strokeWidth="1.5" />
      <circle cx="15" cy="15" r="8" stroke="var(--rail)" strokeWidth="1" />
      <circle cx="15" cy="15" r="4" fill="url(#jack-core)" />
    </svg>
  )
}

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
        <div className="auth-brand">
          <JackMark />
          <span className="eyebrow">remnawave · xray</span>
        </div>
        <h1 className="auth-title">
          Xray UI Editor<span className="auth-caret" aria-hidden="true">_</span>
        </h1>
        <p className="auth-sub">Редактор конфиг-профилей панели</p>

        <div className="field">
          <label className="field-label" htmlFor="password">
            Пароль
          </label>
          <div className="jack-field" data-pending={login.isPending || undefined}>
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
