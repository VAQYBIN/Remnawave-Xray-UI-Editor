// Сквозные сценарии редактора шаблонов Mihomo — по одному на требование спеки.
// Проверяется то, что нельзя проверить модульно: связка «страница → граф →
// форма → ТЕКСТ документа» и то, что уходит в панель.

import { expect, test } from '@playwright/test'
import { CATALOG_MIHOMO_YAML, MIHOMO_UUID, MIHOMO_YAML, mockApi, mockMihomo } from './mocks'
import { pickOption } from './helpers'

/** Строк в документе панели: столько же строк рисует CodeMirror на вкладке YAML */
const BASE_LINES = MIHOMO_YAML.split('\n').length

/** Имя записи каталога, на длине которого ломалась раскладка диалога импорта */
const LONG_CATALOG_NAME = 'Mihomo YAML (RU bundle, category: ads, all)'

const node = (id: string) => `.react-flow__node[data-id="${id}"]`

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

test('правка формы: новый ключ перепечатывает документ без потерь, существующий — точечно', async ({ page }) => {
  await page.locator(node('group:Основная')).click()
  const inspector = page.locator('aside.wb-inspector')
  await inspector.getByRole('button', { name: /Ещё поля/ }).click()
  // exact: true — иначе подстрока задевает соседнее поле exclude-filter
  await inspector.getByLabel('filter', { exact: true }).fill('RU')
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'YAML', exact: true }).click()
  const lines = page.locator('.cm-line')
  // `filter` — НОВЫЙ ключ группы: режим модели, документ перепечатан целиком
  // (Document.toString({ lineWidth: 0 })), число строк и их позиции не
  // гарантированы (пустые строки между секциями сохраняются библиотекой yaml).
  // Инвариант, который обязан пережить круг, — сам ключ и маркер подстановки:
  // без него панель перестанет подставлять серверы, а редактор остался бы зелёным.
  // Ждём строку явно (`toHaveCount` ретраит) — `allTextContents()` сам не
  // повторяет попытку и мог бы прочитать вкладку раньше, чем она домонтировалась
  await expect(lines.filter({ hasText: 'filter: RU' })).toHaveCount(1)
  // Инвариант проверяем по СОДЕРЖИМОМУ, не по точному отступу: режим модели
  // волен переставить вложенность строки — важно, что ключ и маркер выжили
  const beforeScalarEdit = await lines.allTextContents()
  expect(beforeScalarEdit.map((l) => l.trim())).toContain('filter: RU')
  expect(beforeScalarEdit.map((l) => l.trim())).toContain('# LEAVE THIS LINE!')

  // Второй шаг — правка СУЩЕСТВУЮЩЕГО скаляра (log-level: info в корне документа,
  // объявлен изначально в фикстуре) идёт через панель «Документ», а не через
  // узел группы: это тот же писатель, но другой путь по дереву. Правка обязана
  // остаться сплайсом — байты вне неё не меняются, то есть меняется РОВНО одна
  // строка (байт в байт, без trim), а не перепечатывается весь документ заново
  await page.getByRole('button', { name: 'Топология' }).click()
  await page.getByRole('button', { name: 'Документ' }).click()
  await inspector.getByRole('button', { name: 'Общие' }).click()
  await pickOption(page, inspector.getByLabel('log-level'), 'debug')

  await page.getByRole('button', { name: 'YAML', exact: true }).click()
  await expect(lines.filter({ hasText: 'log-level: debug' })).toHaveCount(1)
  const afterScalarEdit = await lines.allTextContents()

  expect(afterScalarEdit).toHaveLength(beforeScalarEdit.length)
  const idx = beforeScalarEdit.findIndex((l) => l === 'log-level: info')
  expect(idx).toBeGreaterThanOrEqual(0)
  expect(afterScalarEdit[idx]).toBe('log-level: debug')
  // Все ОСТАЛЬНЫЕ строки — байт в байт те же, что были: сплайс правит диапазон
  // ровно одного значения и не трогает форматирование вокруг
  const beforeRest = beforeScalarEdit.filter((_, i) => i !== idx)
  const afterRest = afterScalarEdit.filter((_, i) => i !== idx)
  expect(afterRest).toEqual(beforeRest)
})

test('клик по синтаксической ошибке ведёт к её месту, а не в начало', async ({ page }) => {
  await page.getByRole('button', { name: 'YAML', exact: true }).click()
  const lines = page.locator('.cm-line')

  // Ломаем документ в самом конце: незакрытая flow-последовательность даёт
  // ошибку разбора с точным местом и без всякого пути — путь у неё назвать
  // нечем, документ на этом месте и не разобрался
  await lines.last().click()
  await page.keyboard.press('End')
  await page.keyboard.type('broken: [')
  // Редактор закрывает скобку сам — снимаем закрывающую, иначе документ
  // остаётся валидным и проверять было бы нечего
  await page.keyboard.press('Delete')
  const broken = lines.filter({ hasText: 'broken: [' })
  await expect(broken).toHaveCount(1)

  // Уводим каретку в начало: иначе она осталась бы на месте ошибки и тест
  // проходил бы, ничего не проверив
  await lines.first().click()
  await expect(page.locator('.cm-activeLine')).toHaveText('mode: rule')

  await page.locator('.wb-status-toggle').click()
  await page.getByRole('button', { name: /Синтаксис YAML/ }).first().click()

  // Каретка уехала на сломанную строку. Прежде клик по этой диагностике не
  // делал ничего: список навигирует по пути, а путь у неё пуст — место
  // терялось в разборе, хотя библиотека его и отдавала
  await expect(page.locator('.cm-activeLine')).toContainText('broken: [')
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
  for (const card of await dialog.locator('.import-card').all()) {
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
  await expect(dialog.locator('.import-card')).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)

  // Обе карточки сразу: у короткого имени чип и в потоке вставал справа —
  // разъезжался он именно на длинном, уезжая под имя на вторую строку
  for (const card of await dialog.locator('.import-card').all()) {
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

test('выбранная запись отличается на вид от остальных', async ({ page }) => {
  await page.getByRole('button', { name: 'Импорт' }).click()
  const dialog = page.getByRole('dialog', { name: 'Импорт шаблона из каталога' })
  const cards = dialog.locator('.import-card')
  const bg = (card: typeof cards) =>
    card.evaluate((el) => getComputedStyle(el).backgroundColor)

  const idle = await bg(cards.nth(1))
  await cards.nth(1).click()
  // Уводим курсор: под ним карточка подсвечена наведением, и сравнение
  // сравнивало бы hover с покоем, а не выбор с невыбранным
  await page.mouse.move(0, 0)
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true')

  const chosen = await bg(cards.nth(1))
  expect(chosen).not.toBe(idle)
  // И от соседа тоже: выбор виден в самом списке, а не только в предпросмотре
  expect(chosen).not.toBe(await bg(cards.nth(0)))
})

// Отдельный describe: своя фикстура (пустой документ, encodedTemplateYaml:
// null) и своё условие готовности страницы — вместо узла группы на холсте
// ждём кнопку «+ Добавить» (граф пуст).
test.describe('с нуля', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    await mockMihomo(page, { template: null })
    await page.goto(`/templates/${MIHOMO_UUID}`)
    await expect(page.getByRole('button', { name: '+ Добавить' })).toBeVisible()
  })

  test('шаблон собирается кнопками и формами, вкладка YAML не открывается', async ({ page }) => {
    const patches: string[] = []
    await page.route('**/api/templates/*', async (route) => {
      if (route.request().method() === 'PATCH') patches.push(route.request().postData() ?? '')
      await route.fallback()
    })
    const inspector = page.locator('aside.wb-inspector')
    const add = async (item: string) => {
      await page.getByRole('button', { name: '+ Добавить' }).click()
      await page.getByRole('menuitem', { name: item }).click()
    }

    await add('Группа')
    await expect(inspector.getByLabel('Имя')).toHaveValue('Группа')
    await add('Сервер')
    await expect(page.locator(node('proxy:Сервер'))).toBeVisible()
    await add('Провайдер')
    await expect(page.locator(node('provider:provider'))).toBeVisible()
    await add('Набор правил')
    // Заведённая запись живёт в панели «Документ» — узла на холсте у неё нет,
    // раздел закрыт по умолчанию, как и все разделы этой панели
    await inspector.getByRole('button', { name: 'Наборы правил' }).click()
    await expect(inspector.getByRole('region', { name: 'Наборы правил' })).toBeVisible()
    await add('Подсписок')
    await expect(page.locator(node('subrule:sub-rule'))).toBeVisible()
    await add('Вход')

    await page.getByRole('button', { name: '+ Правило' }).click()
    await expect(inspector.getByLabel('Тип')).toBeVisible()
    await pickOption(page, inspector.getByLabel('Тип'), 'DOMAIN-SUFFIX')
    await inspector.getByLabel('Значение').fill('example.com')

    await page.getByRole('button', { name: 'Документ' }).click()
    await inspector.getByRole('button', { name: 'DNS' }).click()
    await inspector.getByRole('region', { name: 'DNS' }).getByRole('button', { name: 'Завести раздел' }).click()

    await page.getByRole('button', { name: 'Рецепты' }).click()
    await page.getByRole('dialog').getByText('Локальные сети напрямую').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Применить' }).click()

    await page.getByRole('button', { name: 'Сохранить в панель' }).click()
    // Собранный документ несёт предупреждения (нет MATCH в конце rules, у
    // ruleset нет ссылки) — панель их не блокирует, а диалог из-за них меняет
    // подпись кнопки на «Сохранить всё равно»; сохранению это не мешает.
    // Локатор — от диалога: кнопка топбара «Сохранить в панель» тоже
    // начинается на «Сохранить» и осталась видна под диалогом
    await page
      .getByRole('dialog', { name: 'Сохранить в панель' })
      .getByRole('button', { name: /^Сохранить/ })
      .click()
    await expect.poll(() => patches.length).toBe(1)
    const yaml = Buffer.from(JSON.parse(patches[0]!).encodedTemplateYaml, 'base64').toString('utf8')
    expect(yaml).toContain('- name: Группа')
    expect(yaml).toContain('- name: Сервер')
    expect(yaml).toContain('provider:')
    expect(yaml).toContain('ruleset:')
    expect(yaml).toContain('sub-rule:')
    expect(yaml).toContain('- name: вход')
    expect(yaml).toContain('DOMAIN-SUFFIX,example.com,DIRECT')
    expect(yaml).toContain('enhanced-mode: fake-ip')
    expect(yaml).toContain('RULE-SET,geoip-private,DIRECT,no-resolve')
    // Вкладка YAML так и не открывалась
    await expect(page.locator('.cm-editor')).toHaveCount(0)
  })
})
