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

test('печать не дёргает бэкенд на каждый символ — запрос уходит после паузы', async ({ page }) => {
  let geoCalls = 0
  page.on('request', (r) => {
    if (r.url().includes('/api/tools/geo/match')) geoCalls += 1
  })

  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Трасса' }).click()
  await page.getByLabel('Адрес').pressSequentially('api.openai.com', { delay: 30 })

  // Пока печатаем, за geo-ответами не ходим: иначе каждый символ пересчитывал бы граф
  expect(geoCalls).toBe(0)
  await expect(page.locator('.trace-panel')).toBeVisible()
  expect(geoCalls).toBeLessThanOrEqual(1)
})

test('узлы графа не исчезают во время ввода', async ({ page }) => {
  await page.goto(`/profiles/${UUID}`)
  await page.getByRole('button', { name: 'Трасса' }).click()
  const before = await page.locator('.react-flow__node').count()
  expect(before).toBeGreaterThan(0)

  const address = page.getByLabel('Адрес')
  await address.pressSequentially('api.openai.com', { delay: 30 })

  // Узлы обязаны остаться в DOM и остаться видимыми: пересборка графа на каждый
  // символ перезапускала бы анимацию появления, и узлы не успевали бы проявиться
  expect(await page.locator('.react-flow__node').count()).toBe(before)
  const opacities = await page
    .locator('.react-flow__node .fnode')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity))
  expect(opacities.every((o) => Number(o) > 0.9)).toBe(true)
})
