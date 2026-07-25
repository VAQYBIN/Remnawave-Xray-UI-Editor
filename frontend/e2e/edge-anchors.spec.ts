import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

/**
 * Рёбра должны выходить точно из гнёзд сразу после загрузки. Ловушка: входная
 * анимация `.fnode` сдвигает карточку на 8px вниз, и если React Flow снимет
 * позиции хэндлов в этот момент, все рёбра так и останутся на 8px ниже — до
 * первого перетаскивания любого узла, которое заставляет пересчитать внутренности.
 */
async function anchorGap(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const node = document.querySelector('.react-flow__node[data-id="in:vless-in"]')!
    const handle = node.querySelector('.react-flow__handle-right')!.getBoundingClientRect()
    const path = document.querySelector(
      '.react-flow__edge[data-id^="e:in:vless-in"] path',
    ) as SVGPathElement
    const start = path.getPointAtLength(0)
    const screen = new DOMPoint(start.x, start.y).matrixTransform(path.getScreenCTM()!)
    return Math.abs(screen.y - (handle.top + handle.height / 2))
  })
}

test('ребро выходит из гнезда сразу после загрузки, без перетаскивания', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
  // Ждём конца входной анимации (360 мс + задержка до 210 мс) с запасом
  await page.waitForTimeout(1200)

  expect(await anchorGap(page)).toBeLessThan(1.5)
})

test('перетаскивание узла не сдвигает рёбра относительно гнёзд', async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="dns"]')).toBeVisible()
  await page.waitForTimeout(1200)

  const dns = page.locator('.react-flow__node[data-id="dns"]')
  await dns.hover()
  await page.mouse.down()
  await page.mouse.move(400, 400, { steps: 5 })
  await page.mouse.up()

  expect(await anchorGap(page)).toBeLessThan(1.5)
})
