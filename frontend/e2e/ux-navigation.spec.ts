import { expect, test } from '@playwright/test'
import { CONFIG, PROFILE, UUID, mockApi } from './mocks'

// Конфиг с заведомой проблемой: Reality поверх ws — ошибка матрицы совместимости
const BROKEN = {
  ...CONFIG,
  inbounds: [
    {
      ...CONFIG.inbounds[0],
      streamSettings: { network: 'ws', security: 'reality' },
    },
  ],
}

async function openBroken(page: import('@playwright/test').Page) {
  await mockApi(page)
  await page.route(`**/api/profiles/${UUID}`, (r) =>
    r.fulfill({ json: { profile: { ...PROFILE, config: BROKEN } } }),
  )
  await page.goto(`/profiles/${UUID}`)
}

test('узел с ошибкой помечен значком', async ({ page }) => {
  await openBroken(page)
  const node = page.locator('.react-flow__node[data-id="in:vless-in"]')
  await expect(node.locator('.node-issue-error')).toBeVisible()
})

test('клик по проблеме открывает инспектор нужного узла', async ({ page }) => {
  await openBroken(page)
  await page.getByRole('button', { name: /ошибок:/ }).click()
  await page.getByRole('button', { name: /Reality/ }).first().click()
  await expect(page.locator('aside')).toContainText('vless-in')
})

test('на вкладке JSON клик по проблеме выделяет её место', async ({ page }) => {
  await openBroken(page)
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await page.getByRole('button', { name: /ошибок:/ }).click()
  await page.getByRole('button', { name: /Reality/ }).first().click()
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected).toContain('reality')
})

test('поиск находит узел и открывает его', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await page.getByLabel('Поиск по конфигу').fill('vless')
  await page.getByRole('button', { name: /vless-in/ }).first().click()
  await expect(page.locator('aside')).toContainText('vless-in')
})
