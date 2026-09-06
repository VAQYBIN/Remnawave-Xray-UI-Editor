// Сквозные сценарии редактора шаблонов Mihomo — по одному на требование спеки.
// Проверяется то, что нельзя проверить модульно: связка «страница → граф →
// форма → ТЕКСТ документа» и то, что уходит в панель.

import { expect, test } from '@playwright/test'
import { CATALOG_MIHOMO_YAML, MIHOMO_UUID, MIHOMO_YAML, mockApi, mockMihomo } from './mocks'

/** Строк в документе панели: столько же строк рисует CodeMirror на вкладке YAML */
const BASE_LINES = MIHOMO_YAML.split('\n').length

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await mockMihomo(page)
  await page.goto(`/templates/${MIHOMO_UUID}`)
  await expect(page.locator('.react-flow__node[data-id="group:Основная"]')).toBeVisible()
})

test('шаблон Mihomo открывается в редакторе, а не ведёт в панель', async ({ page }) => {
  // Тупиковая ветка «редактор такого типа не открывает» осталась для CLASH и
  // прочих — на MIHOMO её быть не должно
  await expect(page.getByText('Откройте его в панели')).toHaveCount(0)
  await expect(page.getByText('шаблон MIHOMO')).toBeVisible()
  // Формат содержимого — YAML, и это видно по подписи текстовой вкладки: она
  // выводится из docFormat, от которого зависит и весь диалог версий
  await expect(page.getByRole('button', { name: 'YAML', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'JSON', exact: true })).toHaveCount(0)
})

test('правка группы правит документ точечно и не трогает маркер', async ({ page }) => {
  await page.locator('.react-flow__node[data-id="group:Основная"]').click()
  const inspector = page.locator('aside')
  await inspector.getByRole('button', { name: /Ещё поля/ }).click()
  // exact: true — иначе подстрока задевает соседнее поле exclude-filter
  await inspector.getByLabel('filter', { exact: true }).fill('RU')
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'YAML', exact: true }).click()
  const lines = page.locator('.cm-line')
  // Главное свойство архитектуры, проверенное через настоящий интерфейс: правка
  // формы — сплайс, а не перепечатка. Строк стало ровно на одну больше (новый
  // ключ), и стоит она вплотную к своей секции, а маркер подстановки остался
  // последней строкой списка proxies — иначе панель перестанет подставлять
  // серверы, а редактор при этом останется зелёным.
  await expect(lines).toHaveCount(BASE_LINES + 1)
  await expect(lines.nth(6)).toHaveText('filter: RU')
  await expect(lines.nth(7)).toHaveText('proxies:')
  await expect(lines.nth(8)).toHaveText('- Резерв')
  await expect(lines.nth(9)).toHaveText('# LEAVE THIS LINE!')
})

test('сохранение шлёт encodedTemplateYaml, конфликт по хэшу предлагает выбор', async ({ page }) => {
  const patches: string[] = []
  await page.route('**/api/templates/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    patches.push(route.request().postData() ?? '')
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'конфликт', current: {}, hash: 'x'.repeat(64) }),
    })
  })

  await page.locator('.react-flow__node[data-id="group:Основная"]').click()
  const inspector = page.locator('aside')
  await inspector.getByRole('button', { name: /Ещё поля/ }).click()
  await inspector.getByLabel('filter', { exact: true }).fill('RU')

  await page.getByRole('button', { name: 'Сохранить в панель' }).click()
  await page
    .getByRole('dialog', { name: 'Сохранить в панель' })
    .getByRole('button', { name: /^Сохранить/ })
    .click()

  // У шаблона нет updatedAt: базой оптимистической блокировки служит хэш, и
  // расхождение обязано дать выбор, а не молча перезаписать панель
  await expect(page.getByText('Конфликт версий')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Загрузить версию панели' })).toBeVisible()

  expect(patches).toHaveLength(1)
  const body = JSON.parse(patches[0]!)
  // Содержимое Mihomo живёт в encodedTemplateYaml; templateJson здесь — чужое
  // поле, и панель по нему перезаписала бы шаблон не тем форматом
  expect(typeof body.encodedTemplateYaml).toBe('string')
  expect(body.templateJson).toBeUndefined()
  expect(body.expectedHash).toEqual(expect.any(String))
  // Текст доезжает целиком: base64 — от utf-8, а не от btoa(), иначе кириллица
  // в именах групп уронила бы сохранение
  expect(Buffer.from(body.encodedTemplateYaml, 'base64').toString('utf8')).toContain('filter: RU')
})

test('проверка ядром показывает отчёт с оговоркой про фиктивные серверы', async ({ page }) => {
  await page.getByRole('button', { name: 'Проверить ядром' }).click()
  await expect(page.getByText('Ядро приняло шаблон')).toBeVisible()
  // Оговорка обязательна: ядро смотрело документ с подставленными прокси, и без
  // неё вердикт читается как приговор настоящему шаблону
  await expect(page.getByText(/фиктивн/i)).toBeVisible()
})

test('импорт из каталога подставляет содержимое в редактор, а не в панель', async ({ page }) => {
  const patches: string[] = []
  await page.route('**/api/templates/*', async (route) => {
    if (route.request().method() === 'PATCH') patches.push('patch')
    await route.fallback()
  })

  await page.getByRole('button', { name: 'Импорт' }).click()
  const dialog = page.getByRole('dialog', { name: 'Импорт шаблона из каталога' })
  // Незнакомый каталогу тип не роняет список, но и импортировать его нельзя —
  // фильтр по умолчанию показывает только тип открытого документа
  await expect(dialog.getByText('singbox-legacy')).toHaveCount(0)
  await dialog.getByText('mihomo-default').click()
  await expect(dialog.locator('pre')).toContainText('Каталог')
  await dialog.getByRole('button', { name: 'Импортировать в редактор' }).click()

  // Документ заменён целиком: на холсте группа из каталога, а не из панели
  await expect(page.locator('.react-flow__node[data-id="group:Каталог"]')).toBeVisible()
  await expect(page.locator('.react-flow__node[data-id="group:Основная"]')).toHaveCount(0)
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
  // Импорт правит черновик: в панель ничего не ушло, и Ctrl+Z возвращает как было
  expect(patches).toHaveLength(0)
  expect(CATALOG_MIHOMO_YAML).not.toEqual(MIHOMO_YAML)

  await page.keyboard.press('Control+z')
  await expect(page.locator('.react-flow__node[data-id="group:Основная"]')).toBeVisible()
  await expect(page.locator('.react-flow__node[data-id="group:Каталог"]')).toHaveCount(0)
  await expect(page.getByText('черновик', { exact: true })).toHaveCount(0)
})
