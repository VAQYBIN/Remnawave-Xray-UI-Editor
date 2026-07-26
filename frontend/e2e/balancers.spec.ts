import { expect, test } from '@playwright/test'
import { connect } from './helpers'
import { UUID, mockApi } from './mocks'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('балансер собирается кабелями и показывает кандидатов', async ({ page }) => {
  await page.getByRole('button', { name: '+ Балансер' }).click()
  await expect(page.locator('.react-flow__node[data-id="bal:balancer"]')).toBeVisible()

  await connect(page, 'rule:0', 'bal:balancer')
  await connect(page, 'bal:balancer', 'out:direct')
  await connect(page, 'bal:balancer', 'out:block')

  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->bal:balancer"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e:bal:balancer->out:direct"]')).toBeVisible()
  await expect(page.locator('.react-flow__edge[data-id="e:bal:balancer->out:block"]')).toBeVisible()

  // Правило переехало на балансер — прежнего кабеля в outbound не осталось
  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->out:direct"]')).toHaveCount(0)

  await page.locator('.react-flow__node[data-id="bal:balancer"]').click()
  const inspector = page.locator('aside')
  await expect(inspector.getByText(/Кандидаты:.*direct/)).toBeVisible()
  await expect(inspector.getByText(/Кандидаты:.*block/)).toBeVisible()
})
