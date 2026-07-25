import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

// Узкий вьюпорт — чтобы ~30-строчный конфиг гарантированно переполнил редактор
test.use({ viewport: { width: 900, height: 480 } })

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

async function assertScrollable(page: import('@playwright/test').Page, containerSel: string) {
  const scroller = page.locator(`${containerSel} .cm-scroller`)
  await expect(scroller).toBeVisible()
  const box = await scroller.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
  // .cm-scroller ограничен контейнером, а документ выше — значит есть что скроллить
  expect(box.scrollHeight, 'документ должен быть выше видимой области').toBeGreaterThan(box.clientHeight + 20)
  // и он реально скроллится
  await scroller.evaluate((el) => { el.scrollTop = 200 })
  const top = await scroller.evaluate((el) => el.scrollTop)
  expect(top, 'scroller должен прокручиваться').toBeGreaterThan(50)
}

test('вкладка JSON: редактор скроллится', async ({ page }) => {
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await assertScrollable(page, '.wb-canvas')
})

test('JSON узла в инспекторе: редактор скроллится', async ({ page }) => {
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  const inspector = page.locator('aside')
  await inspector.getByRole('button', { name: 'JSON узла' }).click()
  await assertScrollable(page, '.wb-inspector-body-flush')
})
