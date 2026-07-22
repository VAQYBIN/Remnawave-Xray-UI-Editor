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
