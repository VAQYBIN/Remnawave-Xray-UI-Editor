// Сквозные сценарии редактора шаблонов Mihomo — по одному на требование спеки.
// Проверяется то, что нельзя проверить модульно: связка «страница → граф →
// форма → ТЕКСТ документа» и то, что уходит в панель.

import { expect, test } from '@playwright/test'
import { CATALOG_MIHOMO_YAML, MIHOMO_UUID, MIHOMO_YAML, mockApi, mockMihomo } from './mocks'

/** Строк в документе панели: столько же строк рисует CodeMirror на вкладке YAML */
const BASE_LINES = MIHOMO_YAML.split('\n').length

/** Имя записи каталога, на длине которого ломалась раскладка диалога импорта */
const LONG_CATALOG_NAME = 'Mihomo YAML (RU bundle, category: ads, all)'

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

test('трассировка называет ПЕРВОЕ совпавшее правило, а не любое подходящее', async ({ page }) => {
  await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
  await page.getByLabel('Адрес').fill('ya.ru')

  // В фикстуре три правила: #1 (example.com) не подходит, #2 (ya.ru) подходит,
  // #3 (MATCH) подошёл бы тоже — и цель у него ДРУГАЯ. Проверяем именно
  // победителя, а не факт появления панели: разбор, назвавший #3, дал бы такую
  // же панель с таким же видом и увёл бы трафик в другую группу
  const panel = page.locator('.trace-panel')
  await expect(page.getByText(/Победило правило #2/)).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/Победило правило #[13]/)).toHaveCount(0)
  await expect(panel.locator('.trace-winner')).toContainText('Основная')
  await expect(panel.locator('.trace-winner')).not.toContainText('Резерв')
  await expect(panel.locator('.trace-rule[data-winner="true"] .trace-rule-no')).toHaveText('#2')
  // Ниже победителя список не выполняется — правила #3 в разборе нет вовсе
  await expect(panel.locator('.trace-rule')).toHaveCount(2)

  // Карточка на холсте помечена маршрутом — и ровно одна: проигравшее правило
  // называется проигравшим, а недостигнутое молчит
  await expect(page.locator('.react-flow__node[data-id="rule:1"]')).toContainText('маршрут')
  await expect(page.locator('.react-flow__node[data-id="rule:0"]')).toContainText('не совпало')
  await expect(page.locator('.react-flow__node[data-id="rule:0"]')).not.toContainText('маршрут')
  await expect(page.locator('.react-flow__node[data-id="rule:2"]')).not.toContainText('маршрут')
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

test('карточка каталога не наезжает на предпросмотр', async ({ page }) => {
  await page.getByRole('button', { name: 'Импорт' }).click()
  const dialog = page.getByRole('dialog', { name: 'Импорт шаблона из каталога' })

  // Выбираем запись с самым длинным именем: предпросмотр появляется только
  // после выбора, а мерить наложение не на чем, пока справа стоит подсказка
  await dialog.getByRole('button', { name: LONG_CATALOG_NAME }).click()
  const preview = dialog.locator('pre')
  await expect(preview).toContainText('Каталог')
  // Ширина карточки — метрики текста: до подмены шрифта она другая (см. тот же
  // приём в dock-layout.spec.ts)
  await page.evaluate(() => document.fonts.ready)

  const previewBox = (await preview.boundingBox())!
  for (const card of await dialog.locator('.check-item').all()) {
    const box = (await card.boundingBox())!
    // Проверяем не ширину карточки, а само свойство: список живёт в своей
    // колонке. У кнопки `.btn` строка нерушима, поэтому длинное имя растило
    // карточку вправо, и она рисовалась поверх содержимого шаблона
    expect(box.x + box.width).toBeLessThanOrEqual(previewBox.x)
  }
})

test('тип шаблона стоит в правом верхнем углу карточки', async ({ page }) => {
  await page.getByRole('button', { name: 'Импорт' }).click()
  const dialog = page.getByRole('dialog', { name: 'Импорт шаблона из каталога' })
  await expect(dialog.locator('.import-item')).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)

  // Обе карточки сразу: у короткого имени чип и в потоке вставал справа —
  // разъезжался он именно на длинном, уезжая под имя на вторую строку
  for (const card of await dialog.locator('.import-item').all()) {
    const box = (await card.boundingBox())!
    const chip = (await card.locator('.chip').boundingBox())!
    const author = (await card.locator('.muted').boundingBox())!
    expect(box.x + box.width - (chip.x + chip.width)).toBeLessThan(12)
    expect(chip.y - box.y).toBeLessThan(12)
    // Тип выше автора, а не в одной строке с ним
    expect(chip.y).toBeLessThan(author.y)
  }
})

test('предпросмотр занимает высоту области и не выходит за неё', async ({ page }) => {
  await page.getByRole('button', { name: 'Импорт' }).click()
  const dialog = page.getByRole('dialog', { name: 'Импорт шаблона из каталога' })
  await dialog.getByRole('button', { name: LONG_CATALOG_NAME }).click()
  const preview = dialog.locator('pre')
  await expect(preview).toContainText('Каталог')

  const area = (await dialog.locator('.import-body').boundingBox())!
  const box = (await preview.boundingBox())!
  // Шаблон каталога короткий: по содержимому рамка была бы в разы ниже области
  expect(box.height).toBeGreaterThanOrEqual(area.height - 2)
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height + 1)
})
