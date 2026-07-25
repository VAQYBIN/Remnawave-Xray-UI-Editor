import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

// В моке уже есть outbound block (blackhole) — рецепт его переиспользует,
// поэтому признак применения здесь именно новое правило, а не новый узел выхода
const ruleNodes = (page: import('@playwright/test').Page) =>
  page.locator('.react-flow__node[data-id^="rule:"]')

test('рецепт блокировки торрентов применяется и откатывается', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await expect(ruleNodes(page)).toHaveCount(1)

  await page.getByRole('button', { name: '+ Рецепт' }).click()
  await page.getByRole('button', { name: /Блокировка торрентов/ }).click()
  await expect(page.getByText(/протокол bittorrent/)).toBeVisible()
  // Существующий block переиспользуется, а не создаётся заново
  await expect(page.getByText(/outbound block — уже есть/)).toBeVisible()

  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(ruleNodes(page)).toHaveCount(2)

  // Рецепт — один снимок истории: Ctrl+Z убирает всё разом
  await page.keyboard.press('Control+z')
  await expect(ruleNodes(page)).toHaveCount(1)
})

test('повторное применение показывает, что всё уже есть', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node').first()).toBeVisible()

  await page.getByRole('button', { name: '+ Рецепт' }).click()
  await page.getByRole('button', { name: /Блокировка рекламы/ }).click()
  await page.getByRole('button', { name: 'Применить', exact: true }).click()

  await page.getByRole('button', { name: '+ Рецепт' }).click()
  await page.getByRole('button', { name: /Блокировка рекламы/ }).click()
  await expect(page.getByText(/уже есть/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Применить', exact: true })).toBeDisabled()
})
