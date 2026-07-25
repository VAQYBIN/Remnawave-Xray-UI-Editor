import { expect, test } from '@playwright/test'
import { CONFIG, PROFILE, UUID, mockApi } from './mocks'

// Профиль с geo-правилом нужен третьему тесту; общий CONFIG не трогаем
const GEO_CONFIG = {
  ...CONFIG,
  routing: { rules: [{ type: 'field', domain: ['geosite:openai'], outboundTag: 'block' }] },
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.route(`**/api/profiles/${UUID}`, (r) =>
    r.fulfill({ json: { profile: { ...PROFILE, config: GEO_CONFIG } } }),
  )
})

test('диалог geo-баз открывается из топбара и показывает, что базы не загружены', async ({
  page,
}) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Geo-базы' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('не загружена')
  await expect(dialog).toContainText('на нодах')
})

test('пресет Loyalsoldier подставляет ссылки', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Geo-базы' }).click()
  await page.getByRole('button', { name: 'Loyalsoldier' }).click()
  await expect(page.getByLabel('Ссылка на geosite')).toHaveValue(/Loyalsoldier/)
})

test('из caveat трассировки можно открыть диалог geo-баз', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Трасса' }).click()
  await page.getByLabel('Адрес').fill('api.openai.com')
  await expect(page.locator('.trace-panel')).toContainText('Geo-базы не загружены')
  await page.locator('.trace-caveats').getByRole('button', { name: 'Geo-базы' }).click()
  await expect(page.getByRole('dialog')).toContainText('не загружена')
})

test('категория из просмотра уходит в новое правило', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)

  await page.getByRole('button', { name: 'Geo-базы' }).click()
  await page.getByRole('button', { name: 'Просмотр' }).click()
  await page.getByRole('button', { name: /GOOGLE/ }).click()
  await expect(page.getByText('google.com').first()).toBeVisible()
  await page.getByRole('button', { name: 'В правило' }).click()

  // Правило создано, черновик помечен изменённым
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(2)
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})
