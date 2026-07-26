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

test('инспектор — форма Reality', async ({ page }) => {
  await mockShowcase(page)
  await page.goto(`/profiles/${SHOWCASE_UUID}`)
  await settle(page)
  await page.locator('.react-flow__node[data-id="in:vless-reality"]').click()
  const inspector = page.locator('aside')
  await inspector.waitFor({ state: 'visible' })
  // Reality лежит ниже транспорта: прокручиваем инспектор к кнопке генерации
  // ключей — она и есть главный аргумент против ручного JSON
  await inspector.getByRole('button', { name: 'Сгенерировать ключи' }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/inspector-reality.png` })
})

test('JSON узла — автоподсказки', async ({ page }) => {
  await mockShowcase(page)
  await page.goto(`/profiles/${SHOWCASE_UUID}`)
  await settle(page)
  await page.locator('.react-flow__node[data-id="in:vless-reality"]').click()
  const inspector = page.locator('aside')
  await inspector.getByRole('button', { name: 'JSON узла' }).click()
  const content = inspector.locator('.cm-content')
  await content.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  // insertText вставляет разом, минуя авто-закрытие скобок
  await page.keyboard.insertText(
    ['{', '  "tag": "vless-reality",', '  "port": 443,', '  "protocol": "vless",', '  "settings": {', '    "clients": [],', '    "'].join('\n'),
  )
  await page.keyboard.press('Control+Space')
  await page.locator('.cm-tooltip-autocomplete').waitFor({ state: 'visible' })
  await page.waitForTimeout(300)
  // Кадр целиком тут не годится: всплывашка заняла бы проценты площади и в
  // README оказалась бы нечитаемой. Режем по панели инспектора.
  const box = await inspector.boundingBox()
  if (!box) throw new Error('инспектор не отрисован')
  await page.screenshot({
    path: `${OUT}/json-intellisense.png`,
    clip: { x: box.x, y: box.y, width: box.width, height: 340 },
  })
})
