import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/App'

afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('без сессии показывает экран входа', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'Требуется вход' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
  })
})
