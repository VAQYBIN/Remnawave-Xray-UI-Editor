import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

// Открыть JSON-узла inbound-а и заменить содержимое на заданный (возможно
// незакрытый) текст. insertText вставляет разом, минуя авто-закрытие скобок.
async function openNodeJsonWith(page: import('@playwright/test').Page, doc: string) {
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  const inspector = page.locator('aside')
  await inspector.getByRole('button', { name: 'JSON узла' }).click()
  const content = inspector.locator('.cm-content')
  await content.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(doc)
}

test('автоподсказка ключей settings по protocol', async ({ page }) => {
  await openNodeJsonWith(page, '{ "protocol": "vless", "settings": { "')
  await page.keyboard.press('Control+Space')
  const pop = page.locator('.cm-tooltip-autocomplete')
  await expect(pop).toBeVisible()
  await expect(pop).toContainText('flow')
  await expect(pop).toContainText('fallbacks')
})

test('автоподсказка значения flow → xtls-rprx-vision', async ({ page }) => {
  await openNodeJsonWith(page, '{ "protocol": "vless", "settings": { "flow": "')
  await page.keyboard.press('Control+Space')
  const pop = page.locator('.cm-tooltip-autocomplete')
  await expect(pop).toBeVisible()
  await expect(pop).toContainText('xtls-rprx-vision')
})

test('Tab применяет подсказку', async ({ page }) => {
  await openNodeJsonWith(page, '{ "protocol": "vless", "settings": { "fl')
  await page.keyboard.press('Control+Space')
  await expect(page.locator('.cm-tooltip-autocomplete [aria-selected="true"]')).toBeVisible()
  // Дать состоянию автодополнения устояться: сразу после открытия оно ещё не
  // «active», и acceptCompletion сработал бы вхолостую (реальный юзер и так
  // делает паузу перед Tab). Пауза устраняет гонку в тесте.
  await page.waitForTimeout(350)
  await page.keyboard.press('Tab')
  // подсказка применена — «fl» дополнено до flow, выпадашка закрыта
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0)
  await expect(page.locator('aside .cm-content')).toContainText('flow')
})

test('Tab без подсказок делает обычный отступ', async ({ page }) => {
  await openNodeJsonWith(page, 'X')
  // выпадашки нет — Tab должен вставить отступ перед X, а не проглотиться
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0)
  await page.keyboard.press('Home')
  await page.keyboard.press('Tab')
  const line = (await page.locator('aside .cm-line').first().textContent()) ?? ''
  expect(/^\s+X/.test(line)).toBe(true)
})

test('hover по ключу показывает описание', async ({ page }) => {
  await openNodeJsonWith(page, '{ "protocol": "vless", "streamSettings": { "network": "tcp" } }')
  // навести на существующий ключ network
  await page.locator('.cm-content').getByText('network', { exact: false }).first().hover()
  const tip = page.locator('.cm-xray-hover')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('Транспорт')
})
