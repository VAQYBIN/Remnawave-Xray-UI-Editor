import { useEffect, useRef } from 'react'

export interface Hotkey {
  /** 'mod+z' | 'mod+shift+z' | 'mod+y' | 'mod+f' | 'Escape' | '?' */
  combo: string
  handler: (event: KeyboardEvent) => void
  /** По умолчанию хоткей молчит, когда фокус в поле ввода */
  whenEditable?: boolean
  /** По умолчанию совпавший хоткей отменяет действие браузера */
  preventDefault?: boolean
}

/**
 * Поле ввода, textarea, select или contenteditable. Последнее покрывает и
 * `.cm-content` CodeMirror — иначе Ctrl+Z в JSON-редакторе перехватывался бы
 * историей приложения вместо посимвольной отмены редактора.
 *
 * Атрибут проверяем по цепочке предков, а не только `isContentEditable`: событие
 * может прийти от вложенного узла разметки редактора, а в jsdom это свойство
 * вообще не реализовано.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('[contenteditable="true"], [contenteditable=""]') !== null) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Открыт ли нативный модальный диалог — тогда Escape его, а не наш */
export function hasOpenDialog(): boolean {
  return document.querySelector('dialog[open]') !== null
}

export function matchCombo(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1] ?? ''
  if (event.key.toLowerCase() !== key) return false
  const mod = event.ctrlKey || event.metaKey
  if (parts.includes('mod')) {
    if (!mod) return false
    // Ctrl+Shift+Z и Ctrl+Z — разные хоткеи, различаем строго
    return event.shiftKey === parts.includes('shift')
  }
  // Без модификатора shift не проверяем: «?» на большинстве раскладок набирается с ним
  return !mod
}

export function useHotkeys(hotkeys: Hotkey[]): void {
  // Массив пересобирается на каждый рендер, а слушатель вешаем один раз —
  // свежие обработчики берём из ref, иначе они замкнутся на первый рендер
  const ref = useRef(hotkeys)
  ref.current = hotkeys

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const editable = isEditableTarget(event.target)
      for (const hk of ref.current) {
        if (!matchCombo(event, hk.combo)) continue
        if (editable && !hk.whenEditable) continue
        if (hk.preventDefault !== false) event.preventDefault()
        hk.handler(event)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
