import { test, type Page } from '@playwright/test'
import { SHOWCASE_UUID, mockShowcase } from './showcase'

const OUT = '../docs/screenshots'

/**
 * Анимации НЕ глушим инъекцией CSS, хотя это обычный приём детерминированной
 * съёмки. Здесь он сломал бы картинку: `RemeasureOnEnter` пересчитывает якоря
 * рёбер по событию animationend, и без анимаций событие не придёт — все рёбра
 * окажутся на 8px ниже своих гнёзд. Вместо этого дожидаемся, пока входная
 * анимация карточек отыграет (задержки по колонкам — до 210 мс).
 */
async function settle(page: Page) {
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible' })
  // Сквады приезжают отдельной ручкой уже после того, как fitView отработал на
  // монтировании, поэтому их колонка оказывается за кадром. Дожидаемся её и
  // вписываем граф заново кнопкой самого React Flow.
  await page.locator('.react-flow__node[data-id^="squad:"]').first().waitFor({ state: 'visible' })
  await page.locator('.react-flow__controls-fitview').click()
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== 'running'),
    undefined,
    { timeout: 5_000 },
  )
  await page.waitForTimeout(400)
}

test('топология — герой-кадр', async ({ page }) => {
  await mockShowcase(page)
  await page.goto(`/profiles/${SHOWCASE_UUID}`)
  await settle(page)
  await page.screenshot({ path: `${OUT}/topology.png` })
})
