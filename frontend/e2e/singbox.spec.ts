// Сквозные сценарии редактора шаблонов sing-box — по одному на требование
// спеки. Проверяется то, чего не проверить модульно: связка «страница → граф →
// форма → ДОКУМЕНТ» и то, что уходит в панель.

import { expect, test } from '@playwright/test'
import { CATALOG_SINGBOX_JSON, SINGBOX_JSON, SINGBOX_UUID, mockApi, mockSingbox } from './mocks'
import { pickOption } from './helpers'

const node = (id: string) => `.react-flow__node[data-id="${id}"]`

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await mockSingbox(page)
  await page.goto(`/templates/${SINGBOX_UUID}`)
  await expect(page.locator(node('group:Выбор'))).toBeVisible()
})

test('шаблон sing-box открывается в редакторе, а не ведёт в панель', async ({ page }) => {
  // Тупиковая ветка «редактор такого типа не открывает» осталась для CLASH и
  // прочих — на SINGBOX её быть не должно
  await expect(page.getByText('Откройте его в панели')).toHaveCount(0)
  await expect(page.getByText('шаблон SINGBOX')).toBeVisible()
  // Подпись текстовой вкладки выводится из docFormat, а он у sing-box — диалект
  // JSON: YAML здесь означал бы, что документ приняли за шаблон Mihomo
  await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'YAML', exact: true })).toHaveCount(0)
})

test('список группы до закрепления только на чтение', async ({ page }) => {
  await page.locator(node('group:Выбор')).click()
  const inspector = page.locator('aside.wb-inspector')

  // Пока панель заполняет список сама, правка в нём исчезла бы при первой же
  // выдаче подписки: панель перезаписывает список ЦЕЛИКОМ
  const list = inspector.getByLabel('Участники (список заполняет панель)')
  await expect(list).toHaveValue('direct')
  await expect(list).toHaveJSProperty('readOnly', true)
  // Читающий обязан узнать, ЧЕМ панель заменит список, — иначе поле выглядит
  // просто сломанным
  await expect(inspector.getByText(/Панель перезапишет его целиком/)).toBeVisible()
  await expect(inspector.getByRole('button', { name: 'Закрепить список' })).toBeVisible()
})

test('правка формы группы правит документ и не трогает чужие ключи', async ({ page }) => {
  const patches: string[] = []
  await page.route('**/api/templates/*', async (route) => {
    if (route.request().method() === 'PATCH') patches.push(route.request().postData() ?? '')
    await route.fallback()
  })

  await page.locator(node('group:Выбор')).click()
  await page.locator('aside.wb-inspector').getByRole('button', { name: 'Закрепить список' }).click()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
  // Отказ панели заполнять группу виден и на холсте: подпись карточки — это
  // единственное место, где сказано, чей будет список
  await expect(page.locator(node('group:Выбор'))).toContainText('закреплён')

  // Правка идёт в ТЕКСТ документа, а не в какое-то состояние формы: ключ панели
  // — camelCase и ровно со значением false (подстановку включает не «true», а
  // отсутствие ключа)
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await expect(page.locator('.cm-line').filter({ hasText: '"includeProxies": false' })).toHaveCount(1)

  // Что стало с ОСТАЛЬНЫМ документом, видно только целиком — вкладка показывает
  // лишь видимые строки (CodeMirror рисует свой вьюпорт). Поэтому сверяем то,
  // что уйдёт в панель: форма печатает документ целиком, и потеря чужого ключа
  // прошла бы незамеченной — редактор при этом остался бы зелёным
  await page.getByRole('button', { name: 'Сохранить в панель' }).click()
  await page
    .getByRole('dialog', { name: 'Сохранить в панель' })
    .getByRole('button', { name: /^Сохранить/ })
    .click()
  await expect(page.getByText('черновик', { exact: true })).toHaveCount(0)

  expect(patches).toHaveLength(1)
  const expected = JSON.parse(JSON.stringify(SINGBOX_JSON))
  expected.outbounds[0].remnawave = { includeProxies: false }
  expect(JSON.parse(patches[0]!).templateJson).toEqual(expected)
})

test('сохранение шлёт templateJson, конфликт по хэшу предлагает выбор', async ({ page }) => {
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

  await page.locator(node('group:Выбор')).click()
  await page.locator('aside.wb-inspector').getByRole('button', { name: 'Закрепить список' }).click()

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
  // Содержимое JSON-шаблона живёт в templateJson; encodedTemplateYaml здесь —
  // чужое поле, и бэкенд отвечает на него четырёхсотым. Слать оба значило бы
  // спрятать эту защиту от себя же
  expect(body.encodedTemplateYaml).toBeUndefined()
  expect(body.expectedHash).toEqual(expect.any(String))
  // Уходит именно правка формы, а не разобранная схемой модель
  expect(body.templateJson.outbounds[0].remnawave).toEqual({ includeProxies: false })
  expect(body.templateJson.route.rules).toEqual(SINGBOX_JSON.route.rules)
})

test('трассировка называет ПЕРВОЕ совпавшее правило и усекает список', async ({ page }) => {
  await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
  await page.getByLabel('Адрес').fill('ya.ru')

  // В фикстуре четыре правила: #1 (sniff) совпадает со всем, но выход не
  // выбирает, #2 (ya.ru) побеждает, #4 подошёл бы тоже — и цель у него ДРУГАЯ.
  // Проверяем именно победителя: разбор, назвавший #4, дал бы такую же панель
  // с таким же видом и увёл бы трафик в другой выход
  const panel = page.locator('.trace-panel')
  await expect(page.getByText(/Победило правило #2/)).toBeVisible()
  await expect(page.getByText(/Победило правило #[134]/)).toHaveCount(0)
  await expect(panel.locator('.trace-winner')).toContainText('Выбор')
  await expect(panel.locator('.trace-winner')).not.toContainText('direct')
  await expect(panel.locator('.trace-rule[data-winner="true"] .trace-rule-no')).toHaveText('#2')
  // Ниже победителя список не выполняется — правил #3 и #4 в разборе нет вовсе
  await expect(panel.locator('.trace-rule')).toHaveCount(2)

  // Карточка на холсте помечена маршрутом — и ровно одна: недостигнутые правила
  // молчат, потому что у них не «нет данных», их просто не проверяли
  await expect(page.locator(node('rule:1'))).toContainText('маршрут')
  await expect(page.locator(`${node('rule:0')} .trace-badge`)).toHaveText('совпало')
  await expect(page.locator(`${node('rule:2')} .trace-badge`)).toHaveCount(0)
  await expect(page.locator(`${node('rule:3')} .trace-badge`)).toHaveCount(0)
})

test('трассировка честно останавливается на непроверяемом условии', async ({ page }) => {
  await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
  await page.getByLabel('Адрес').fill('example.org')
  // IP заполняем сами: без него проход встал бы раньше, на ip_is_private, и
  // сценарий проверял бы не ту остановку
  await page.getByLabel('IP назначения').fill('8.8.8.8')

  const panel = page.locator('.trace-panel')
  // Содержимое набора правил качает клиент, а не редактор. Промолчать здесь
  // значило бы дать уверенный неверный ответ: всё, что ниже, выполняется ровно
  // при условии, что этот набор не совпал, — а этого мы не знаем
  await expect(page.getByText(/Проход остановлен на правиле #4/)).toBeVisible()
  // Причина стоит и у самого правила: в списке видно, ЧТО именно не проверено
  await expect(panel.locator('.trace-rule').nth(3).locator('.trace-field')).toContainText(
    'содержимое набора правил (geosite-ads)',
  )
  await expect(panel.locator('.trace-rule[data-winner="true"]')).toHaveCount(0)
  await expect(panel.locator('.trace-rule')).toHaveCount(4)
  // Бейдж говорит о ПРИЧИНЕ (условие проверить нечем), а не о последствии
  await expect(page.locator(`${node('rule:3')} .trace-badge`)).toHaveText('проверить нечем')
})

test('проверка ядром показывает отчёт с оговоркой про фиктивные серверы', async ({ page }) => {
  await page.getByRole('button', { name: 'Проверить ядром' }).click()
  await expect(page.getByText('Ядро приняло шаблон')).toBeVisible()
  // Оговорка обязательна: ядро смотрело документ с дописанными в конец
  // фиктивными серверами и без ключа remnawave, и без неё вердикт читается как
  // приговор настоящему шаблону
  await expect(page.getByText(/фиктивн/i)).toBeVisible()
})

test('импорт из каталога подставляет содержимое в черновик, а не в панель', async ({ page }) => {
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
  await dialog.getByText('singbox-default').click()
  await expect(dialog.locator('pre')).toContainText('Каталог')
  await dialog.getByRole('button', { name: 'Импортировать в редактор' }).click()

  // Документ заменён целиком: на холсте группа из каталога, а не из панели
  await expect(page.locator(node('group:Каталог'))).toBeVisible()
  await expect(page.locator(node('group:Выбор'))).toHaveCount(0)
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
  // Импорт правит черновик: в панель ничего не ушло, и Ctrl+Z возвращает как было
  expect(patches).toHaveLength(0)
  expect(CATALOG_SINGBOX_JSON).not.toEqual(SINGBOX_JSON)

  await page.keyboard.press('Control+z')
  await expect(page.locator(node('group:Выбор'))).toBeVisible()
  await expect(page.locator(node('group:Каталог'))).toHaveCount(0)
  await expect(page.getByText('черновик', { exact: true })).toHaveCount(0)
})

test('клик по диагностике ведёт к её месту в тексте', async ({ page }) => {
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  const lines = page.locator('.cm-line')

  // Переименовываем ГРУППУ — правка стоит в начале документа, а место
  // диагностики (ссылка правила на прежний тег) — в его хвосте, за пределами
  // нарисованного вьюпорта CodeMirror. Ровно поэтому «прокрутить к месту» здесь
  // и есть единственный способ его увидеть
  const target = lines.filter({ hasText: '"tag": "Выбор"' })
  await expect(target).toHaveCount(1)
  await target.click()
  await page.keyboard.press('End')
  // Две влево: за закрывающей кавычкой стоит запятая, и без второго шага буква
  // уехала бы за строку и сломала JSON
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('X')
  await expect(lines.filter({ hasText: '"tag": "ВыборX"' })).toHaveCount(1)

  // Уводим каретку в начало: иначе она осталась бы на месте правки и тест
  // проходил бы, ничего не проверив
  await lines.first().click()
  await expect(page.locator('.cm-activeLine')).toHaveText('{')

  await page.locator('.wb-status-toggle').click()
  await page.getByRole('button', { name: /неизвестный выход/ }).first().click()

  // Каретка уехала на место ссылки: в тексте список диагностик ведёт к месту, а
  // не к узлу графа, — вкладку при этом не переключает
  await expect(page.locator('.cm-activeLine')).toContainText('"outbound": "Выбор"')
})

// Отдельный describe: своя фикстура (пустой документ) и своё условие готовности
// страницы — вместо узла группы на холсте ждём кнопку «+ Добавить» (граф пуст).
test.describe('с нуля', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
    await mockSingbox(page, { template: {} })
    await page.goto(`/templates/${SINGBOX_UUID}`)
    await expect(page.getByRole('button', { name: '+ Добавить' })).toBeVisible()
  })

  test('шаблон собирается кнопками и формами, вкладка JSON не открывается', async ({ page }) => {
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

    await add('Вход')
    await expect(inspector.getByLabel('Тег')).toHaveValue('mixed-in')
    await add('Группа')
    await expect(page.locator(node('group:select'))).toBeVisible()
    await add('Выход')
    await expect(page.locator(node('out:direct'))).toBeVisible()

    await page.getByRole('button', { name: '+ Правило' }).click()
    // Кнопка дока сама выбор не переносит (правило заводится по индексу, а не
    // тегом) — переходим на новый узел кликом, как это делает писатель
    await page.locator(node('rule:0')).click()
    await expect(inspector.getByLabel('Действие')).toBeVisible()
    await inspector.getByLabel('Суффикс домена').fill('example.com')

    await page.getByRole('button', { name: 'Документ' }).click()
    await inspector.getByRole('button', { name: 'DNS-серверы' }).click()
    await inspector.getByRole('button', { name: '+ Сервер' }).click()
    await inspector.getByRole('button', { name: 'DNS-правила' }).click()
    await inspector.getByRole('button', { name: '+ DNS-правило' }).click()
    await inspector.getByRole('button', { name: 'Наборы правил' }).click()
    await inspector.getByRole('button', { name: '+ Набор правил' }).click()
    await inspector.getByRole('button', { name: 'Маршрут' }).click()
    // Раздел route уже существует: «+ Правило» завёл его сам (`route ??= {}`),
    // так что «Завести раздел» здесь не нужна — сразу форма
    const routeRegion = inspector.getByRole('region', { name: 'Маршрут' })
    // `final` не заполнен по умолчанию — форма прячет незаполненные поля под
    // крышку «Ещё поля», иначе пустой раздел маршрута захламил бы верх формы
    await routeRegion.getByRole('button', { name: /Ещё поля/ }).click()
    await pickOption(page, routeRegion.getByLabel('final'), 'select')

    await page.getByRole('button', { name: 'Сохранить в панель' }).click()
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect.poll(() => patches.length).toBe(1)
    const body = JSON.parse(patches[0]!).templateJson
    expect(body.inbounds[0].tag).toBe('mixed-in')
    expect(body.outbounds.map((o: { tag: string }) => o.tag)).toEqual(['select', 'direct'])
    expect(body.route.rules[0].domain_suffix).toEqual(['example.com'])
    expect(body.route.final).toBe('select')
    expect(body.dns.servers).toHaveLength(1)
    expect(body.dns.rules).toHaveLength(1)
    expect(body.route.rule_set).toHaveLength(1)
    // Вкладка JSON так и не открывалась
    await expect(page.locator('.cm-editor')).toHaveCount(0)
  })
})

test('порядок выходов меняет маршрут по умолчанию на карточке', async ({ page }) => {
  await page.locator(node('out:direct')).click()
  await expect(page.locator(node('group:Выбор'))).toContainText('по умолчанию')
  await page.locator('aside.wb-inspector').getByRole('button', { name: 'Переместить выше' }).click()
  await expect(page.locator(node('out:direct'))).toContainText('по умолчанию')
})

test('рецепт DNS с fake-ip заводит серверы и правила', async ({ page }) => {
  await page.getByRole('button', { name: 'Рецепты' }).click()
  await page.getByRole('button', { name: /DNS с fake-ip/ }).click()
  // Кнопка «Применить» отключена до заполнения обязательного параметра —
  // адреса удалённого DNS (validateDns требует непустой remote)
  await page.getByLabel('Удалённый DNS').fill('1.1.1.1')
  await page.getByRole('button', { name: 'Применить' }).click()
  await page.getByRole('button', { name: 'Документ' }).click()
  await page.locator('aside.wb-inspector').getByRole('button', { name: 'DNS-серверы' }).click()
  await expect(page.locator('aside.wb-inspector').getByText('dns-fakeip')).toBeVisible()
})
