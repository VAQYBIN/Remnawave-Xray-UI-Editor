import { expect, test } from '@playwright/test'
import { CONFIG, PROFILE, UUID, mockApi } from './mocks'

test.describe('Проверка конфига', () => {
  test('ядро недоступно — редактор сообщает об этом', async ({ page }) => {
    await mockApi(page)
    await page.goto(`/profiles/${UUID}`)
    await page.getByRole('button', { name: 'Проверить конфиг' }).click()
    await expect(page.getByText(/проверка ядром недоступна/i)).toBeVisible()
  })

  test('ошибка ядра показывается с подсказкой', async ({ page }) => {
    await mockApi(page)
    // Позже зарегистрированный обработчик Playwright перекрывает мок из mockApi
    await page.route('**/api/tools/xray-test', (r) =>
      r.fulfill({
        json: {
          available: true,
          ok: false,
          version: '26.6.27',
          errors: [
            {
              message: 'app/router: unable to find outbound tag: proxy',
              hint: 'Правило ссылается на тег outbound, которого нет в конфиге.',
            },
          ],
          warnings: [],
          injected: ['vless-in'],
        },
      }),
    )
    await page.goto(`/profiles/${UUID}`)
    await page.getByRole('button', { name: 'Проверить конфиг' }).click()
    await expect(page.getByText('unable to find outbound tag: proxy')).toBeVisible()
    await expect(page.getByText(/которого нет в конфиге/)).toBeVisible()
    await expect(page.getByText(/подставным пользователем/i)).toBeVisible()
  })

  test('Reality-цель проверяется по кнопке', async ({ page }) => {
    await mockApi(page)
    const withReality = {
      ...CONFIG,
      inbounds: [
        {
          ...CONFIG.inbounds[0],
          streamSettings: {
            network: 'tcp',
            security: 'reality',
            realitySettings: {
              target: 'www.microsoft.com:443',
              serverNames: ['www.microsoft.com'],
            },
          },
        },
      ],
    }
    await page.route(`**/api/profiles/${UUID}`, (r) =>
      r.fulfill({ json: { profile: { ...PROFILE, config: withReality } } }),
    )
    await page.route('**/api/tools/reality-target', (r) =>
      r.fulfill({
        json: {
          target: 'www.microsoft.com:443',
          reachable: true,
          checks: [{ id: 'tls13', level: 'ok', title: 'TLS 1.3' }],
        },
      }),
    )
    await page.goto(`/profiles/${UUID}`)
    await page.getByRole('button', { name: 'Проверить конфиг' }).click()
    await page.getByRole('button', { name: /проверить цель/i }).click()
    await expect(page.getByText('TLS 1.3')).toBeVisible()
  })
})
