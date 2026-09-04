import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'
import { pickOption } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('удаление правила отменяется кнопкой и повторяется возвратом', async ({ page }) => {
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)
  await page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]').click()
  await page.keyboard.press('Backspace')
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)

  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(0)
})

test('Ctrl+Z отменяет правку с клавиатуры', async ({ page }) => {
  await page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]').click()
  await page.keyboard.press('Backspace')
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)
})

test('на вкладке JSON кнопки истории заблокированы', async ({ page }) => {
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Вернуть' })).toBeDisabled()
})

test('«?» открывает шпаргалку по горячим клавишам', async ({ page }) => {
  // Именно символ, а не 'Shift+/': во втором случае Playwright шлёт key='/',
  // тогда как браузер на реальном нажатии отдаёт key='?'
  await page.keyboard.press('?')
  await expect(page.getByText('Поиск по конфигу на топологии')).toBeVisible()
})

test('сравнение бэкапа показывает обе стороны и возвращает к списку', async ({ page }) => {
  // exact: true — иначе подстрока задевает «Сбросить к версии панели»
  await page.getByRole('button', { name: 'Версии', exact: true }).click()
  await page.getByRole('button', { name: 'Сравнить' }).click()
  await expect(page.locator('.diff-frame .cm-editor')).toHaveCount(2)
  await page.getByRole('button', { name: '← К списку' }).click()
  await expect(page.getByRole('button', { name: 'Сравнить' })).toBeVisible()
})

test('сброс черновика пишет историю — отмена возвращает правку', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  await pickOption(page, inspector.getByLabel('Flow'), 'xtls-rprx-vision')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()

  // exact: true — иначе подстрока задевает «Сбросить к версии панели»
  await page.getByRole('button', { name: 'Сбросить к версии панели', exact: true }).click()
  const resetDialog = page.getByRole('dialog', { name: 'Сбросить черновик' })
  await expect(resetDialog).toBeVisible()
  await resetDialog.getByRole('button', { name: 'Сбросить', exact: true }).click()
  await expect(page.getByText('черновик', { exact: true })).toHaveCount(0)

  // Сброс обязан записать текущий текст в историю: иначе отменять нечего и
  // кнопка отмены останется заблокированной. Порядок записи и очистки при
  // этом не важен — resetDraft держит текст в замыкании, а не читает из стора
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})

test('вкладка «Файл» скачивает конфиг', async ({ page }) => {
  // exact: true — иначе подстрока задевает «Сбросить к версии панели»
  await page.getByRole('button', { name: 'Версии', exact: true }).click()
  await page.getByRole('button', { name: 'Файл' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Скачать JSON/ }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^e2e-profile-\d{4}-\d{2}-\d{2}\.json$/)
})
