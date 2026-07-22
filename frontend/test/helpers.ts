import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** Опции кастомного Select живут в портале — берём их из открытого listbox */
function optionsOf(listbox: HTMLElement) {
  return within(listbox).getAllByRole('option')
}

function labelOf(option: HTMLElement): string {
  return option.querySelector('.select-option-label')?.textContent?.trim() ?? ''
}

async function openList(target: string | HTMLElement): Promise<HTMLElement> {
  const trigger = typeof target === 'string' ? screen.getByLabelText(target) : target
  await userEvent.click(trigger)
  return screen.getByRole('listbox')
}

/**
 * Замена userEvent.selectOptions для кастомного Select: открывает список и кликает
 * опцию по value (как у нативного select) либо по видимой подписи.
 */
export async function selectOption(target: string | HTMLElement, valueOrLabel: string) {
  const listbox = await openList(target)
  const options = optionsOf(listbox)
  const hit =
    options.find((o) => o.getAttribute('data-value') === valueOrLabel) ??
    options.find((o) => labelOf(o) === valueOrLabel)
  if (!hit) {
    const known = options.map((o) => `${o.getAttribute('data-value')} (${labelOf(o)})`).join(', ')
    throw new Error(`Опция «${valueOrLabel}» не найдена. Доступны: ${known}`)
  }
  await userEvent.click(hit)
}

/** Подписи опций — для проверок «какие варианты предлагаются». Список закрывается обратно. */
export async function optionLabels(target: string | HTMLElement): Promise<string[]> {
  const listbox = await openList(target)
  const labels = optionsOf(listbox).map(labelOf)
  await userEvent.keyboard('{Escape}')
  return labels
}

/** Текущее значение кастомного Select (у кнопки-триггера нет value) */
export function selectedValue(target: string | HTMLElement): string | null {
  const trigger = typeof target === 'string' ? screen.getByLabelText(target) : target
  return trigger.getAttribute('data-value')
}
