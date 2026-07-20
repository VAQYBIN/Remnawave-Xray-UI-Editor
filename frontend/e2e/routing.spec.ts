import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'

test('lazy-роутинг: список профилей → редактор', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await expect(page.getByText('E2E Profile')).toBeVisible()
  await page.getByText('E2E Profile').click()
  await expect(page).toHaveURL(new RegExp(`/profiles/${UUID}`))
  await expect(page.locator(`.react-flow__node[data-id="in:vless-in"]`)).toBeVisible()
})
