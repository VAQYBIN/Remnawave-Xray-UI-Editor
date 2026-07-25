import { describe, expect, it, vi } from 'vitest'
import { fireEvent, renderHook } from '@testing-library/react'
import { isEditableTarget, matchCombo, useHotkeys } from '../src/shared/lib/useHotkeys'

function key(init: KeyboardEventInit & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('matchCombo', () => {
  it('mod+z ловит и Ctrl, и Cmd', () => {
    expect(matchCombo(key({ key: 'z', ctrlKey: true }), 'mod+z')).toBe(true)
    expect(matchCombo(key({ key: 'z', metaKey: true }), 'mod+z')).toBe(true)
  })

  it('mod+z не срабатывает без модификатора и с shift', () => {
    expect(matchCombo(key({ key: 'z' }), 'mod+z')).toBe(false)
    expect(matchCombo(key({ key: 'z', ctrlKey: true, shiftKey: true }), 'mod+z')).toBe(false)
  })

  it('mod+shift+z требует shift', () => {
    expect(matchCombo(key({ key: 'Z', ctrlKey: true, shiftKey: true }), 'mod+shift+z')).toBe(true)
    expect(matchCombo(key({ key: 'z', ctrlKey: true }), 'mod+shift+z')).toBe(false)
  })

  it('mod+y и mod+f', () => {
    expect(matchCombo(key({ key: 'y', ctrlKey: true }), 'mod+y')).toBe(true)
    expect(matchCombo(key({ key: 'f', metaKey: true }), 'mod+f')).toBe(true)
  })

  it('«?» матчится, хотя набирается с shift', () => {
    expect(matchCombo(key({ key: '?', shiftKey: true }), '?')).toBe(true)
  })

  it('Escape не матчится с модификатором', () => {
    expect(matchCombo(key({ key: 'Escape' }), 'Escape')).toBe(true)
    expect(matchCombo(key({ key: 'Escape', ctrlKey: true }), 'Escape')).toBe(false)
  })
})

describe('isEditableTarget', () => {
  it('input, textarea и contenteditable — редактируемые', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const cm = document.createElement('div')
    cm.setAttribute('contenteditable', 'true')
    document.body.append(cm)
    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(textarea)).toBe(true)
    expect(isEditableTarget(cm)).toBe(true)
    cm.remove()
  })

  it('обычный div и null — нет', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('useHotkeys', () => {
  it('вызывает обработчик по совпадению', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys([{ combo: 'mod+z', handler }]))
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('молчит, когда фокус в поле ввода', () => {
    const handler = vi.fn()
    const input = document.createElement('input')
    document.body.append(input)
    renderHook(() => useHotkeys([{ combo: 'mod+z', handler }]))
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()
    input.remove()
  })

  it('whenEditable пропускает хоткей и в поле ввода', () => {
    const handler = vi.fn()
    const input = document.createElement('input')
    document.body.append(input)
    renderHook(() => useHotkeys([{ combo: 'Escape', handler, whenEditable: true }]))
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(handler).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('снимает слушатель при размонтировании', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useHotkeys([{ combo: 'mod+z', handler }]))
    unmount()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()
  })
})
