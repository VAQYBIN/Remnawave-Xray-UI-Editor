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

import defaultYaml from './fixtures/mihomo/default.yaml?raw'
import simpleYaml from './fixtures/mihomo/simple.yaml?raw'
import bundleYaml from './fixtures/mihomo/bundle.yaml?raw'
import roscomvpnYaml from './fixtures/mihomo/roscomvpn.yaml?raw'
import defaultSingbox from './fixtures/singbox/default.json?raw'
import bundleSingbox from './fixtures/singbox/bundle.json?raw'
import legacySingbox from './fixtures/singbox/legacy.json?raw'

const mihomoFixtures = {
  default: defaultYaml,
  simple: simpleYaml,
  bundle: bundleYaml,
  roscomvpn: roscomvpnYaml,
}

/**
 * Настоящие шаблоны из remnawave/templates: якоря, слияния и обе роли маркера.
 * Читаем через `?raw`-импорт Vite (тип объявлен в `vite/client`), а не `node:fs`/`node:url`:
 * фронтенд намеренно не тянет амбиентные типы Node в `src/`, а глобальный `URL` в jsdom —
 * это whatwg-url, а не реализация Node, и она на Windows ломает относительное разрешение
 * `file:`-адреса с буквой диска.
 */
export function mihomoFixture(name: keyof typeof mihomoFixtures): string {
  return mihomoFixtures[name]
}

const singboxFixtures = { default: defaultSingbox, bundle: bundleSingbox, legacy: legacySingbox }

/** Настоящие шаблоны каталога sing-box; про `?raw` вместо `node:fs`/`node:url` — см. `mihomoFixture` выше */
export function singboxFixture(name: keyof typeof singboxFixtures): string {
  return singboxFixtures[name]
}
