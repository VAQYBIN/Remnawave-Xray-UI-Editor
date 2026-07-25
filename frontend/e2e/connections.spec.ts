import { expect, test, type Page } from '@playwright/test'
import { UUID, mockApi } from './mocks'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

/** Протягивает кабель между гнёздами узлов так же, как это делает мышь пользователя */
async function connect(page: Page, from: string, to: string) {
  const source = page.locator(`.react-flow__node[data-id="${from}"] .react-flow__handle-right`)
  const target = page.locator(`.react-flow__node[data-id="${to}"] .react-flow__handle-left`)
  const a = await source.boundingBox()
  const b = await target.boundingBox()
  if (!a || !b) throw new Error(`нет гнезда: ${from} → ${to}`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('inbound соединяется с правилом напрямую', async ({ page }) => {
  // Новое правило создаётся без условий — оно и принимает кабель от inbound
  await page.getByRole('button', { name: '+ Правило' }).click()
  await expect(page.locator('.react-flow__node[data-id="rule:1"]')).toBeVisible()

  await connect(page, 'in:vless-in', 'rule:1')

  await expect(page.locator('.react-flow__edge[data-id="e:in:vless-in->rule:1"]')).toBeVisible()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})

test('правило соединяется с outbound напрямую', async ({ page }) => {
  await connect(page, 'rule:0', 'out:block')

  // outbound у правила один — прежний кабель на direct заменяется
  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->out:block"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]')).toHaveCount(0)
})

test('inbound соединяется с outbound — правило создаётся само', async ({ page }) => {
  await connect(page, 'in:vless-in', 'out:block')

  await expect(page.locator('.react-flow__node[data-id="rule:1"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e:rule:1->out:block"]')).toBeVisible()
})

test('гнездо сквада не коммутируется, обратное направление запрещено', async ({ page }) => {
  // У outbound нет исходящего гнезда — тянуть назад не с чего
  await expect(page.locator('.react-flow__node[data-id="out:direct"] .react-flow__handle-right')).toHaveCount(0)
})

test('переименование outbound не рвёт связь с правилом', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="out:direct"]').click()
  await inspector.getByLabel('Тег', { exact: true }).fill('exit')
  await inspector.getByRole('button', { name: 'Применить' }).click()

  // Правило поехало за новым тегом, старого ребра не осталось
  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->out:exit"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]')).toHaveCount(0)
  // Инспектор остался открытым на переименованном узле
  await expect(inspector.getByLabel('Тег', { exact: true })).toHaveValue('exit')
})
