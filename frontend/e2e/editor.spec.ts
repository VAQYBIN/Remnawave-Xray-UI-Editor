import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'
import { pickOption } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('удаление ребра клавишей Backspace удаляет правило', async ({ page }) => {
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(1)
  await page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]').click()
  await page.keyboard.press('Backspace')
  await expect(page.locator('.react-flow__node[data-id^="rule:"]')).toHaveCount(0)
})

test('Backspace на узле ничего не удаляет', async ({ page }) => {
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  await page.keyboard.press('Backspace')
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('переключение узлов меняет содержимое инспектора без утечки', async ({ page }) => {
  // exact: true — иначе getByText находит ещё и текст закрытого диалога
  // подтверждения удаления узла (он смонтирован в DOM, просто скрыт нативным
  // <dialog> без атрибута open), что даёт strict-mode violation
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  await expect(inspector.getByText('in:vless-in', { exact: true })).toBeVisible()
  await page.locator('.react-flow__node[data-id="out:direct"]').click()
  await expect(inspector.getByText('out:direct', { exact: true })).toBeVisible()
  // getByLabel('Тег') неоднозначен: substring-совпадение (без учёта регистра)
  // задевает и select «Стратегия доменов», и скрытый диалог «Смена тега» —
  // сужаем до textbox с точным accessible name, как и рекомендует сама ошибка
  // strict-mode ("aka getByRole('textbox', { name: 'Тег' })").
  await expect(inspector.getByRole('textbox', { name: 'Тег', exact: true })).toHaveValue('direct')
})

test('форма inbound: выбор flow создаёт черновик', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  await pickOption(page, inspector.getByLabel('Flow'), 'xtls-rprx-vision')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  // exact: true — иначе матчится и текст скрытых диалогов, упоминающих слово «черновик»
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})

test('восстановление бэкапа закрывает инспектор', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  await expect(inspector.getByText('in:vless-in', { exact: true })).toBeVisible()
  // exact: true — иначе подстрока задевает «Сбросить к версии панели»
  await page.getByRole('button', { name: 'Версии', exact: true }).click()
  await page.getByRole('button', { name: 'В черновик' }).click()
  await expect(page.locator('aside')).toHaveCount(0)
})
