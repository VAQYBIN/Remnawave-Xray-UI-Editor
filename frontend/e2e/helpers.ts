import type { Locator, Page } from '@playwright/test'

/**
 * Выбор в кастомном Select: список рендерится порталом в body, поэтому опции
 * ищутся от страницы, а не от контейнера с триггером.
 */
export async function pickOption(page: Page, trigger: Locator, value: string) {
  await trigger.click()
  await page.locator(`[role="option"][data-value="${value}"]`).click()
}

/** Открывает список — для проверок «какие варианты предлагаются» */
export function openOptions(trigger: Locator): Promise<void> {
  return trigger.click()
}

export function optionList(page: Page): Locator {
  return page.locator('[role="listbox"] [role="option"]')
}

/** Протягивает кабель между гнёздами узлов так же, как это делает мышь пользователя */
export async function connect(page: Page, from: string, to: string) {
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
