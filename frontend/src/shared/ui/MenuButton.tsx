// Кнопка-меню: одна кнопка дока вместо восьми. Список едет порталом по тем же
// правилам, что у Select: внутри модального <dialog> — в сам диалог (top layer
// не пробивается z-index'ом), иначе в body; позиция — computePosition оттуда же.

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { computePosition } from './Select'

export interface MenuItem {
  id: string
  label: string
  disabled?: boolean
}

interface Props {
  label: string
  items: MenuItem[]
  onPick: (id: string) => void
  variant?: 'primary' | 'ghost' | 'danger'
  'aria-label'?: string
}

export function MenuButton({ label, items, onPick, variant, 'aria-label': ariaLabel }: Props) {
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [pos, setPos] = useState<ReturnType<typeof computePosition> | null>(null)
  const [active, setActive] = useState(0)

  const openMenu = useCallback(() => {
    const trigger = triggerRef.current
    const rect = trigger?.getBoundingClientRect()
    if (rect) setPos(computePosition(rect, window.innerHeight))
    setContainer(trigger?.closest('dialog') ?? document.body)
    // Ничего не подсвечено при открытии (в отличие от Select — у меню нет
    // «текущего значения»): первая стрелка сама доводит до первого/последнего
    // доступного пункта через step(-1, ...)
    setActive(-1)
    setOpen(true)
  }, [])

  const closeMenu = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const pick = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item || item.disabled) return
      onPick(item.id)
      closeMenu()
    },
    [items, onPick, closeMenu],
  )

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  /** Следующий доступный пункт в направлении dir, по кругу */
  function step(from: number, dir: 1 | -1): number {
    if (items.length === 0) return -1
    let i = from
    for (let n = 0; n < items.length; n += 1) {
      i = (i + dir + items.length) % items.length
      if (!items[i]!.disabled) return i
    }
    return from
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      // Клавишу потребило меню: глобальный Escape закрыл бы заодно инспектор
      e.stopPropagation()
      closeMenu()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => step(i, 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => step(i, -1))
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(active)
      return
    }
    if (e.key === 'Tab') setOpen(false)
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        {label}
      </Button>
      {open &&
        container &&
        createPortal(
          <div
            ref={popRef}
            id={menuId}
            role="menu"
            className="select-pop"
            style={pos ? { top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.width, maxHeight: pos.maxHeight } : undefined}
          >
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="select-option menu-item"
                data-active={index === active ? 'true' : undefined}
                disabled={item.disabled}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
              >
                {item.label}
              </button>
            ))}
          </div>,
          container,
        )}
    </>
  )
}
