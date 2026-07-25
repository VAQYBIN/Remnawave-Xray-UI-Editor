import { expect, test } from '@playwright/test'
import { CONFIG, PROFILE, UUID, mockApi } from './mocks'

// Свой конфиг: geo-правило выше конкретного — так проверяются и вердикты, и caveats.
// Общий CONFIG не трогаем: на его единственное правило опираются routing и connections.
const TRACE_CONFIG = {
  ...CONFIG,
  routing: {
    rules: [
      { type: 'field', domain: ['geosite:openai'], outboundTag: 'block' },
      { type: 'field', domain: ['domain:openai.com'], outboundTag: 'direct' },
    ],
  },
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.route(`**/api/profiles/${UUID}`, (r) =>
    r.fulfill({ json: { profile: { ...PROFILE, config: TRACE_CONFIG } } }),
  )
})

test('трассировка показывает победившее правило и подсвечивает его узел', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Трасса' }).click()
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()

  await page.getByLabel('Адрес').fill('api.openai.com')

  const panel = page.locator('.trace-panel')
  await expect(panel).toBeVisible()
  // Победило второе правило: первое зависит от geo-списка и остаётся неизвестным
  await expect(panel).toContainText('Победило правило #2')
  await expect(panel).toContainText('direct')

  // Вердикт виден и на узле графа
  await expect(page.locator('.react-flow__node[data-id="rule:1"] .trace-badge-winner')).toBeVisible()
})

test('geo-правила честно помечаются как неизвестные', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Трасса' }).click()
  await page.getByLabel('Адрес').fill('api.openai.com')

  const panel = page.locator('.trace-panel')
  await expect(panel).toContainText('Geo-базы не загружены')
  await expect(panel).toContainText('может отличаться')
  await expect(page.locator('.react-flow__node[data-id="rule:0"] .trace-badge-unknown')).toBeVisible()
})

test('очистка адреса убирает панель разбора', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Трасса' }).click()
  const address = page.getByLabel('Адрес')
  await address.fill('api.openai.com')
  await expect(page.locator('.trace-panel')).toBeVisible()
  await address.fill('')
  await expect(page.locator('.trace-panel')).toBeHidden()
})
