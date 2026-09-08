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
// «Процесс». Проверяем не пиксели, а два свойства: строка не переполняется по
// горизонтали (иначе часть полей физически недостижима) и поля не сжимаются до
// нечитаемого.
//
// Замер показал, что сегодня не происходит ни того, ни другого, и объяснение
// оказалось не тем, которое предполагалось при написании этих тестов. Ждали,
// что док — flex-контейнер и содержимое сжимается внутри него; на деле
// `.wb-dock` — абсолютно позиционированная панель React Flow, шириной вьюпорта
// не ограниченная. Строка держит свои 830px на всех трёх ширинах, поля
// сохраняют 144px (и 72px у числового), scrollWidth равен clientWidth. Пятое
// поле стоит фиксированных 144px, а не отъедает их у соседей.
//
// Тест от этого не становится пустым: он покраснеет, если доку когда-нибудь
// зададут ограничение по ширине — тогда поля начнут сжиматься, и заметить это
// на глаз будет уже поздно. Порог, ниже которого строка перестанет помещаться
// в окно, — около 830px по вьюпорту; редактор десктопный, и такие ширины сюда
// намеренно не входят.
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
  })
}
