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
  const closed = (await dock.boundingBox())!

  await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
  await expect(page.getByLabel('Адрес')).toBeVisible()
  const open = (await dock.boundingBox())!

  expect(open.width).toBeLessThanOrEqual(closed.width + 1)
  expect(open.height).toBeGreaterThan(closed.height)
})
