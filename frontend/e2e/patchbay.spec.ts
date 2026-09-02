import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

async function openGraph(page: import('@playwright/test').Page) {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await page.locator('.react-flow__node[data-id="in:vless-in"]').waitFor()
  // Входная волна двигает карточки — ждём, пока она отыграет и якоря пересчитаются
  await page.waitForTimeout(900)
}

const geometry = (node: import('@playwright/test').Locator) =>
  node.evaluate((el) => {
    const card = el.querySelector('.fnode') as HTMLElement
    const handle = el.querySelector('.react-flow__handle-right') as HTMLElement
    const c = card.getBoundingClientRect()
    const h = handle.getBoundingClientRect()
    return { cx: h.left + h.width / 2, cy: h.top + h.height / 2, size: h.width, cardRight: c.right }
  })

/**
 * Жалоба из issue #43: «при наведении на карточку точки съезжают». Карточка
 * поднималась на 1px, гнездо ехало с ней, а кабель оставался на снятых React
 * Flow координатах — гнездо отстёгивалось от кабеля.
 */
test('гнездо не двигается, когда курсор наводится на карточку', async ({ page }) => {
  await openGraph(page)
  const node = page.locator('.react-flow__node[data-id="in:vless-in"]')

  const rest = await geometry(node)
  await node.hover()
  await page.waitForTimeout(350)
  const hovered = await geometry(node)

  expect(hovered.cx).toBeCloseTo(rest.cx, 1)
  expect(hovered.cy).toBeCloseTo(rest.cy, 1)
})

test('гнездо отцентровано на грани карточки, а не висит снаружи', async ({ page }) => {
  await openGraph(page)
  const g = await geometry(page.locator('.react-flow__node[data-id="in:vless-in"]'))
  // Центр гнезда на грани карточки с точностью до её рамки
  expect(Math.abs(g.cx - g.cardRight)).toBeLessThanOrEqual(2)
})

/**
 * Хит-зона крупнее самого джека и не сжимается вместе с холстом: на 2K-экране
 * в гнездо диаметром пять пикселей попасть нечем (issue #43).
 */
test('кабель цепляется, даже когда мышь мимо самого джека', async ({ page }) => {
  await openGraph(page)
  const source = page.locator('.react-flow__node[data-id="in:vless-in"] .react-flow__handle-right')
  const box = await source.boundingBox()
  if (!box) throw new Error('нет гнезда')

  // Промах на 8px вниз от центра — заметно дальше радиуса видимого джека
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + 140, box.y + 40, { steps: 8 })

  await expect(page.locator('.react-flow__connection')).toHaveCount(1)
  await page.mouse.up()
})

/**
 * Обратная сторона крупной хит-зоны: центрированная накрыла бы правый край
 * карточки, и клик по ней тянул бы кабель вместо выбора узла. Зона смещена
 * наружу — карточка остаётся кликабельной до самого края.
 */
test('клик у правого края карточки выбирает узел, а не начинает кабель', async ({ page }) => {
  await openGraph(page)
  const card = page.locator('.react-flow__node[data-id="in:vless-in"] .fnode')
  const box = await card.boundingBox()
  if (!box) throw new Error('нет карточки')

  await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2)

  await expect(page.locator('.wb-inspector')).toBeVisible()
  await expect(page.locator('.react-flow__connection')).toHaveCount(0)
})

test('пока тянут кабель, валидные цели подсвечены, а невалидные — нет', async ({ page }) => {
  await openGraph(page)
  const flow = page.locator('.react-flow')
  await expect(flow).not.toHaveAttribute('data-accepts', /./)

  const source = page.locator('.react-flow__node[data-id="in:vless-in"] .react-flow__handle-right')
  const box = await source.boundingBox()
  if (!box) throw new Error('нет гнезда')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 160, box.y + 60, { steps: 8 })

  // Из inbound кабель идёт в правило или в outbound, но не в балансер
  const accepts = await flow.getAttribute('data-accepts')
  expect(accepts?.split(' ').sort()).toEqual(['out', 'rule'])

  await page.mouse.up()
  await expect(flow).not.toHaveAttribute('data-accepts', /./)
})
