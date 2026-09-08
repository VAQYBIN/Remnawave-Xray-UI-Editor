import { expect, test } from '@playwright/test'
import { MIHOMO_UUID, UUID, mockApi, mockMihomo } from './mocks'

// Раскрытый инструмент уходит во вторую строку дока. Проверяем не пиксели, а
// само свойство: док растёт вниз, а не вширь — иначе он снова накроет правую
// колонку узлов, как это было со строкой трассировки в одну линию.
test('раскрытый инструмент не растит док вширь', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)

  const dock = page.locator('.wb-dock')
  await expect(dock).toBeVisible()
  // Ждём шрифты ПЕРЕД первым замером: ширина дока — это метрики текста кнопок,
  // а Golos Text приезжает отдельным запросом (`@fontsource` в `main.tsx`).
  // Замер до подмены шрифта даёт запасной шрифт и док на ~18px уже, после —
  // настоящий; тогда сравнение «до/после раскрытия» сравнивает не состояния
  // дока, а два разных шрифта. Ловилось редко и только под нагрузкой: закрытый
  // док мерился в 1089px против установившихся 1107px.
  await page.evaluate(() => document.fonts.ready)
  const closed = (await dock.boundingBox())!

  await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
  await expect(page.getByLabel('Адрес')).toBeVisible()
  const open = (await dock.boundingBox())!

  expect(open.width).toBeLessThanOrEqual(closed.width + 1)
  expect(open.height).toBeGreaterThan(closed.height)
})

// У Mihomo в строке трассировки пять полей вместо четырёх — добавилось
// «Процесс», а в топбаре появилась пятая кнопка действий. Проверяем не
// пиксели, а достижимость: правый край строки не выходит за окно, поля не
// сжимаются до нечитаемого и кнопка сохранения остаётся в окне.
//
// Первая редакция этого теста была тавтологией и потому зелёной на сломанном:
// она мерила `scrollWidth <= clientWidth` у самой строки, а `.wb-dock` —
// абсолютно позиционированная панель, её ширина считается по контенту, и это
// равенство выполняется всегда. Мерить надо край относительно ОКНА.
//
// Что было измерено, когда стали мерить правильно (окно / до правки / после):
//   правый край строки:  900 → 1240 / 865      1100 → 1245 / 965
//   кнопка «Сохранить»: 1280 → 1492…1646 / 308…462
// То есть пятое поле было недостижимо ни мышью, ни Tab, а кнопка сохранения
// на распространённой ширине 1280 вообще не показывалась: она стояла за краем
// окна в контейнере с `overflow-x: hidden`.
//
// Причина одна на оба симптома, и она не в строке трассировки: `.wb-topbar` —
// flex без `min-width: 0` и без переноса, его min-content на пяти кнопках шире
// окна, и грид-колонка `.workbench` растягивалась под него вместе со сценой,
// холстом и `.react-flow` (на окне 900px все они были 1660px). React Flow
// центрирует нижнюю панель через `left: 50%` от ширины `.react-flow` — центр
// уезжал к середине раздутой ширины. Чинится переносом в самом топбаре
// (`tokens.css`), после чего колонка равна окну и всё встаёт на место, включая
// случай с открытым инспектором.
for (const width of [1280, 1100, 900]) {
  test(`строка трассировки Mihomo вмещает пять полей на ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApi(page)
    await mockMihomo(page)
    await page.goto(`/templates/${MIHOMO_UUID}`)
    await page.evaluate(() => document.fonts.ready)

    await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
    await expect(page.getByLabel('Процесс')).toBeVisible()

    const bar = page.locator('.trace-bar')
    const barRight = await bar.evaluate((el) => el.getBoundingClientRect().right)
    const metrics = await bar.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      // Числовое поле (Порт) исключено: у него своя проектная ширина 4.5rem
      // = 72px (`.trace-bar .input[inputmode='numeric']`, tokens.css) — этого
      // хватает на любой порт (до 5 цифр), и она не связана со сжатием строки:
      // ниже эмпирически показано, что она равна 72px при любой из трёх
      // ширин, в том числе при 1280px, где строка не испытывает никакого
      // давления. Общий порог читаемости 80px имеет смысл только для полей
      // со свободным текстом (Адрес, IP, Процесс).
      inputs: [...el.querySelectorAll('input:not([inputmode="numeric"])')].map(
        (i) => i.getBoundingClientRect().width,
      ),
      portWidth: el.querySelector('input[inputmode="numeric"]')?.getBoundingClientRect().width,
    }))
    // Переполнение означает, что до части полей не добраться ни мышью, ни Tab
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
    // Поле уже 80px — это два-три видимых символа: формально доступно, на деле нет
    expect(Math.min(...metrics.inputs)).toBeGreaterThan(80)
    // Числовое поле не должно уходить ниже своей проектной ширины — иначе это
    // тоже сжатие, просто с другим порогом
    expect(metrics.portWidth).toBeGreaterThanOrEqual(72)
    // Главная проверка: `.wb-dock` — абсолютно позиционированная панель React
    // Flow, `scrollWidth <= clientWidth` для неё истинно всегда (панель
    // ужимается по контенту, сжимать нечего), поэтому переполнение окна эта
    // проверка не ловит. Ловит только сравнение правого края строки с шириной
    // окна: то, что реально решает, дотянется ли мышь или Tab до поля.
    expect(barRight).toBeLessThanOrEqual(width + 1)

    // Та же причина била и по топбару, и куда больнее: кнопка сохранения
    // уезжала за край окна целиком (на 1280 она стояла на x = 1492…1646) и
    // была недостижима — документ нечем было записать в панель. Проверка
    // стоит здесь, а не отдельным файлом: защищает от той же раздутой колонки
    const saveRight = await page
      .getByRole('button', { name: 'Сохранить в панель' })
      .evaluate((el) => el.getBoundingClientRect().right)
    expect(saveRight).toBeLessThanOrEqual(width + 1)
  })
}
