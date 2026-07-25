import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecipesDialog } from '../src/features/recipes/RecipesDialog'
import type { XrayConfig } from '../src/entities/xray'

const CONFIG = {
  inbounds: [{ tag: 'vless-in', port: 443, protocol: 'vless', settings: { clients: [] } }],
  outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
  routing: { rules: [] },
} as XrayConfig

function renderWith(config: XrayConfig) {
  const onApply = vi.fn<(next: XrayConfig) => void>()
  const onOpenGeo = vi.fn<() => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RecipesDialog open config={config} onApply={onApply} onOpenGeo={onOpenGeo} onClose={() => {}} />
    </QueryClientProvider>,
  )
  return { onApply, onOpenGeo }
}

describe('RecipesDialog', () => {
  it('показывает предпросмотр и применяет рецепт', async () => {
    const { onApply } = renderWith(CONFIG)
    await userEvent.click(screen.getByRole('button', { name: /Блокировка торрентов/ }))
    expect(screen.getByText(/outbound block/)).toBeInTheDocument()
    expect(screen.getByText(/протокол bittorrent/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Применить' }))
    const applied = onApply.mock.calls[0]![0]
    expect(applied.routing!.rules![0]!.protocol).toEqual(['bittorrent'])
  })

  it('при пустом плане и при ошибке параметров «Применить» заблокирована', async () => {
    const applied = {
      ...CONFIG,
      outbounds: [
        { tag: 'direct', protocol: 'freedom', settings: {} },
        { tag: 'block', protocol: 'blackhole', settings: {} },
      ],
      routing: { rules: [{ domain: ['geosite:category-ads-all'], outboundTag: 'block' }] },
    } as XrayConfig
    renderWith(applied)

    await userEvent.click(screen.getByRole('button', { name: /Блокировка рекламы/ }))
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled()
    expect(screen.getAllByText(/уже есть/).length).toBeGreaterThan(0)

    // WARP без ключа — ошибка валидации
    await userEvent.click(screen.getByRole('button', { name: /WARP для сервисов/ }))
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled()
    expect(screen.getByText(/Вставьте приватный ключ/)).toBeInTheDocument()
  })

  it('«Показать diff» рисует обе стороны сравнения', async () => {
    renderWith(CONFIG)
    await userEvent.click(screen.getByRole('button', { name: /Блокировка рекламы/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Показать diff' }))
    expect(document.querySelectorAll('.cm-editor').length).toBe(2)

    await userEvent.click(screen.getByRole('button', { name: '← К параметрам' }))
    expect(screen.getByRole('button', { name: 'Показать diff' })).toBeInTheDocument()
  })

  it('замечание про geo даёт кнопку «Geo-базы»', async () => {
    const { onOpenGeo } = renderWith(CONFIG)
    await userEvent.click(screen.getByRole('button', { name: /Блокировка рекламы/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Geo-базы' }))
    expect(onOpenGeo).toHaveBeenCalled()
  })
})
