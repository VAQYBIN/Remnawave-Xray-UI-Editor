import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

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
